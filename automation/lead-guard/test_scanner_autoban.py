#!/usr/bin/env python3
import contextlib
import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from scanner_policy import eligible, family, parse_access, policy_networks, protected_ip, normalized_path, bounded_events, WINDOW, BAN_SECONDS, MAX_ACTIVE_BANS
from scanner_io import atomic_json, private_json, recent_access_events


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, HERE / path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


helper = load('scanner_autoban', 'scanner-autoban.py')
monitor = load('security_monitor', 'security-monitor.py')
NOW = datetime.datetime(2026, 11, 22, 7, 10, 40, tzinfo=datetime.timezone.utc).timestamp()
IP = '104.239.66.45'
PATHS = ['/.env', '/.env.local', '/.env.production', '/.env.backup', '/.git/HEAD', '/.git/config', '/.aws/credentials', '/.ssh/id_rsa', '/wp-login.php', '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php']


def incident(address=IP, count=60, now=NOW):
    return [{'ip': address, 'time': now - 60 + i * .5, 'method': 'GET', 'path': PATHS[i % len(PATHS)], 'status': 404} for i in range(count)]


def config():
    return {'schemaVersion': 1, 'enabled': True, 'originHost': 'form.tencorp.uz', 'originIps': ['46.62.227.229'], 'operatorCidrs': ['8.8.4.4/32'], 'protectedCidrs': ['104.16.0.0/13', '2606:4700::/32']}


def access(address=IP, target='/.env', method='GET', status=404, timestamp=NOW):
    t = datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).strftime('%d/%b/%Y:%H:%M:%S +0000')
    return f'{address} - - [{t}] "{method} {target} HTTP/1.1" {status} 153 "-" "agent forged-XFF:8.8.8.8"\n'


class PolicyTests(unittest.TestCase):
    def setUp(self): self.networks = policy_networks(config())
    def test_real_scanner_burst(self):
        found = eligible(incident(), NOW, self.networks)
        self.assertEqual([v['ip'] for v in found], [IP]); self.assertGreaterEqual(found[0]['distinctPaths'], 8)
        self.assertTrue(eligible(found[0]['events'], NOW, self.networks))
    def test_cold_paths_api_docs_search_and_wp_alone_are_not_banned(self):
        for path in ['/missing-image.webp', '/openapi.json', '/graphql', '/api/v1/products', '/wp-login.php']:
            values = incident(); values = [{**e, 'path': path} for e in values]
            self.assertEqual(eligible(values, NOW, self.networks), [])
    def test_successes_do_not_count(self):
        self.assertEqual(eligible([{**e, 'status': 200} for e in incident()], NOW, self.networks), [])
    def test_small_or_single_family_bursts_are_not_banned(self):
        self.assertEqual(eligible(incident(count=20), NOW, self.networks), [])
        values = [{**e, 'path': '/.env.' + str(i)} for i, e in enumerate(incident())]
        self.assertEqual(eligible(values, NOW, self.networks), [])
    def test_timestamps_reject_old_and_future_and_malformed(self):
        for t in [NOW-181, NOW+10]: self.assertIsNone(parse_access(access(timestamp=t), NOW))
        self.assertIsNone(parse_access('bad line', NOW))
        self.assertEqual(parse_access(access(), NOW)['ip'], IP)
    def test_does_not_trust_forwarded_header(self):
        self.assertEqual(parse_access(access(), NOW)['ip'], IP)
    def test_protected_addresses(self):
        for address in ['127.0.0.1', '10.0.0.2', '::1', 'fe80::1', '46.62.227.229', '8.8.4.4', '104.16.1.1', '2606:4700::1234']:
            self.assertTrue(protected_ip(address, self.networks)); self.assertEqual(eligible(incident(address), NOW, self.networks), [])
    def test_ipv6_and_mapped_ipv4(self):
        self.assertEqual(eligible(incident('2001:4860:1234::123'), NOW, self.networks)[0]['ip'], '2001:4860:1234::123')
        self.assertEqual(eligible(incident('::ffff:104.239.66.45'), NOW, self.networks)[0]['ip'], IP)
    def test_encoded_paths_and_case(self):
        self.assertEqual(normalized_path('/.%65NV?password=private'), '/.env')
        self.assertEqual(family(normalized_path('/.azure/accessTokens.json')), 'credentials')
        self.assertIsNone(normalized_path('/.%FFenv'))
    def test_duplicate_log_replay_cannot_manufacture_burst(self):
        self.assertEqual(eligible(incident(count=10)*8, NOW, self.networks), [])
    def test_evidence_keeps_early_secret_family(self):
        values = incident() + [{**e, 'time': NOW-10+i*.01, 'path': '/wp-content/probe'+str(i)+'.php'} for i,e in enumerate(incident(count=300))]
        result = eligible(values, NOW, self.networks)[0]
        self.assertTrue(eligible(result['events'], NOW, self.networks))
    def test_unicode_and_quote_heavy_paths_cannot_bloat_state(self):
        self.assertIsNone(normalized_path('/wp-content/'+'а'*200))
        self.assertIsNone(normalized_path('/wp-content/'+'"'*200))
        import json
        values=bounded_events([{**e,'path':'/wp-content/'+'a'*240} for e in incident(count=4000)])
        encoded=json.dumps({'scanner_events':values},ensure_ascii=True,separators=(',',':')).encode()
        self.assertLess(len(encoded),1_100_000)
    def test_operator_safety_config_is_required(self):
        data=config(); del data['operatorCidrs']
        with self.assertRaises(ValueError): policy_networks(data)


class LogTests(unittest.TestCase):
    def setUp(self): self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def test_rotation_timestamp_and_partial_line(self):
        p=self.root/'access.log'; p.write_text(access()); inode=p.stat().st_ino
        old={'inode': inode, 'offset': 0}
        p.rename(self.root/'access.log.1'); p.write_bytes((access(target='/.git/HEAD')+'broken partial').encode())
        values,_,offset,new=monitor.scan_access(p,old,NOW)
        self.assertEqual(len(values),2); self.assertEqual(offset,len(access(target='/.git/HEAD').encode())); self.assertNotEqual(new,inode)
    def test_invalid_utf8_does_not_poison_reader(self):
        p=self.root/'access.log'; p.write_bytes(access(target='/.env%FF').encode()+b'\xff\x00bad\n'+access().encode())
        values,_,_,_=monitor.scan_access(p,{},NOW)
        self.assertEqual(len(values),1)
    def test_outage_never_replays_old_burst(self):
        p=self.root/'access.log'; p.write_text(access(timestamp=NOW-400)+access())
        self.assertEqual(len(monitor.scan_access(p,{},NOW)[0]),1)
    def test_reader_independently_validates_log_owner(self):
        p=self.root/'access.log'; p.write_text(access()); p.chmod(0o640)
        with patch('pwd.getpwnam',return_value=SimpleNamespace(pw_uid=os.geteuid())):
            self.assertEqual(len(recent_access_events(p,NOW)),1)
        p.chmod(0o666)
        with patch('pwd.getpwnam',return_value=SimpleNamespace(pw_uid=os.geteuid())):
            with self.assertRaises(ValueError): recent_access_events(p,NOW)
    def test_oversized_or_corrupt_state_recovers_then_restarts(self):
        p=self.root/'state.json';p.write_bytes(b'x'*2_000_001);p.chmod(0o600)
        with patch.object(monitor,'STATE',p), contextlib.redirect_stdout(io.StringIO()):
            recovered=monitor.load_state(NOW)
            self.assertEqual(recovered['sent'],{})
            atomic_json(p,{**recovered,'scanner_events':bounded_events(incident(count=4000))})
            self.assertEqual(monitor.load_state(NOW)['scanner_events'],private_json(p)['scanner_events'])
            p.write_text('{broken')
            self.assertEqual(monitor.load_state(NOW)['sent'],{})
    def test_private_state_is_atomic_and_rejects_symlinks_and_world_readable(self):
        p=self.root/'state.json'; atomic_json(p,{'ok':True}); self.assertEqual(private_json(p),{'ok':True}); self.assertEqual(p.stat().st_mode&0o777,0o600)
        p.chmod(0o644)
        with self.assertRaises(ValueError): private_json(p)
        q=self.root/'link.json';q.symlink_to(p)
        with self.assertRaises(ValueError): private_json(q)


class EnforcementTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.state=self.root/'state.json';self.deny=self.root/'auto.conf';self.manual=self.root/'manual.conf';self.policy=self.root/'policy.json';self.queue=self.root/'queue.json'
        atomic_json(self.policy,config());atomic_json(self.queue,{'candidates':[{'ip':'8.8.8.8','events':incident('8.8.8.8')}]})
        self.manual.write_text('deny 95.216.224.55;\n'); self.kernel=set();self.owned=set();self.logs=incident();self.messages=[];self.calls=[];self.fail_nginx=False;self.fail_firewall=False;self.fail_bot=False;self.firewall_active=True
        self.stack=contextlib.ExitStack()
        for name,value in [('ROOT',self.root),('STATE',self.state),('DENY',self.deny),('MANUAL',self.manual),('POLICY',self.policy),('QUEUE',self.queue)]:self.stack.enter_context(patch.object(helper,name,value))
        self.stack.enter_context(patch.object(helper,'require_root',return_value=None))
        self.stack.enter_context(patch.object(helper,'local_protected_networks',return_value=[]))
        self.stack.enter_context(patch.object(helper,'root_policy_json',side_effect=lambda p:private_json(p)))
        self.stack.enter_context(patch.object(helper,'origin_is_direct',return_value=True))
        self.stack.enter_context(patch.object(helper,'recent_access_events',side_effect=lambda p,now:self.logs if p.name=='access.log' else []))
        self.stack.enter_context(patch.object(helper,'kernel_rule',side_effect=lambda a:a in self.kernel))
        self.stack.enter_context(patch.object(helper,'command',side_effect=self.command))
        self.stack.enter_context(patch.object(helper,'send_notification',side_effect=self.notify))
    def tearDown(self):self.stack.close();self.tmp.cleanup()
    def command(self,args,timeout=10):
        self.calls.append(args)
        if args[0].endswith('ufw'):
            if args[1]=='status':return SimpleNamespace(stdout='Status: '+('active' if self.firewall_active else 'inactive')+'\n')
            if args[1:3]==['show','added']:return SimpleNamespace(stdout='\n'.join('ufw deny from '+ip+' to any comment '+helper.COMMENT for ip in self.owned))
            if 'insert' in args:
                if self.fail_firewall:raise RuntimeError('firewall unavailable')
                ip=args[args.index('from')+1];self.kernel.add(ip);self.owned.add(ip)
            if 'delete' in args:
                ip=args[args.index('from')+1];self.kernel.discard(ip);self.owned.discard(ip)
        if args[0].endswith('nginx') and self.fail_nginx:raise RuntimeError('bad unrelated nginx config')
        return SimpleNamespace(stdout='',returncode=0)
    def notify(self,item):
        persisted=private_json(self.state)['bans'][item['ip']]
        self.assertTrue(persisted['firewallVerified'])
        if self.fail_bot:raise RuntimeError('network')
        self.messages.append(dict(item))
    def run_enforce(self,now=NOW,**kw):
        with contextlib.redirect_stdout(io.StringIO()):helper.enforce(now=now,**kw)
    def test_only_real_log_source_is_blocked_and_notified_after_persist(self):
        self.run_enforce();self.assertEqual(self.kernel,{IP});self.assertEqual(len(self.messages),1);self.assertNotIn('8.8.8.8',self.kernel)
        self.assertTrue(private_json(self.state)['bans'][IP]['notified']);self.assertIn('deny '+IP+';',self.deny.read_text());self.assertEqual(self.manual.read_text(),'deny 95.216.224.55;\n')
    def test_forged_candidate_queue_without_real_logs_does_nothing(self):
        self.logs=[];self.run_enforce();self.assertEqual(self.kernel,set());self.assertEqual(self.messages,[])
    def test_repeated_ticks_are_idempotent(self):
        self.run_enforce();self.run_enforce(NOW+10);self.assertEqual(len(self.messages),1);self.assertEqual(sum('insert' in c for c in self.calls),1)
    def test_manual_block_is_never_claimed_or_expired(self):
        self.kernel.add(IP);self.manual.write_text('deny '+IP+';\n');self.run_enforce();self.assertEqual(self.messages,[]);self.assertEqual(private_json(self.state)['bans'],{})
    def test_bot_outage_retries_independently_without_reblocking(self):
        self.fail_bot=True;self.run_enforce();self.assertFalse(private_json(self.state)['bans'][IP]['notified'])
        self.fail_bot=False;self.logs=[];self.run_enforce(NOW+301);self.assertEqual(len(self.messages),1);self.assertEqual(sum('insert' in c for c in self.calls),1)
    def test_nginx_failure_retains_verified_firewall_and_restores_prior_file(self):
        self.deny.write_text(helper.HEADER);self.fail_nginx=True;self.run_enforce();self.assertIn(IP,self.kernel);self.assertEqual(self.deny.read_text(),helper.HEADER);self.assertFalse(self.messages[0]['nginxVerified'])
    def test_firewall_failure_never_sends_fake_block_notification_and_retries(self):
        self.fail_firewall=True;self.run_enforce();self.assertEqual(self.messages,[]);self.assertNotIn('deny '+IP+';',self.deny.read_text())
        self.fail_firewall=False;self.run_enforce(NOW+31);self.assertIn(IP,self.kernel);self.assertEqual(len(self.messages),1)
    def test_expiry_works_even_if_policy_is_disabled(self):
        self.run_enforce();data=config();data['enabled']=False;atomic_json(self.policy,data);self.logs=[];self.run_enforce(NOW+BAN_SECONDS+1)
        self.assertNotIn(IP,self.kernel);self.assertNotIn('deny '+IP+';',self.deny.read_text());self.assertEqual(private_json(self.state)['bans'],{})
    def test_safety_allowlist_removes_our_active_block(self):
        self.run_enforce();data=config();data['operatorCidrs'].append(IP+'/32');atomic_json(self.policy,data);self.run_enforce(NOW+10);self.assertNotIn(IP,self.kernel)
    def test_cdn_change_pauses_new_bans(self):
        with patch.object(helper,'origin_is_direct',return_value=False):self.run_enforce()
        self.assertEqual(self.kernel,set());self.assertEqual(self.messages,[])
    def test_unban_only_managed_exact_address(self):
        self.run_enforce();self.logs=[];self.run_enforce(NOW+20,unban=IP);self.assertNotIn(IP,self.kernel);self.assertEqual(private_json(self.state)['bans'],{})
    def test_expiry_removes_our_ufw_rule_even_when_manual_nginx_deny_exists(self):
        self.run_enforce();self.manual.write_text('deny '+IP+';\n');self.logs=[];self.run_enforce(NOW+BAN_SECONDS+1)
        self.assertNotIn(IP,self.owned);self.assertIn('deny '+IP+';',self.manual.read_text());self.assertEqual(private_json(self.state)['bans'],{})
    def test_expiry_and_operator_cleanup_continue_while_firewall_is_inactive(self):
        self.run_enforce();self.firewall_active=False;self.kernel.clear();self.logs=[];self.run_enforce(NOW+BAN_SECONDS+1)
        self.assertEqual(private_json(self.state)['bans'],{});self.assertNotIn(IP,self.owned);self.assertNotIn('deny '+IP+';',self.deny.read_text())
    def test_firewall_inactive_never_creates_new_bans(self):
        self.firewall_active=False;self.run_enforce();self.assertEqual(self.kernel,set());self.assertEqual(self.messages,[])
    def test_pending_proven_incident_retries_beyond_three_minutes(self):
        self.fail_firewall=True;self.run_enforce();self.logs=[];self.fail_firewall=False;self.run_enforce(NOW+301)
        self.assertIn(IP,self.kernel);self.assertEqual(len(self.messages),1)
    def test_forged_verified_state_without_root_proof_does_not_render_deny(self):
        atomic_json(self.state,{'schemaVersion':1,'bans':{IP:{'ip':IP,'createdAt':NOW,'until':NOW+BAN_SECONDS,'lastEventAt':NOW,'firewallVerified':True,'leaseVerified':True}}})
        self.logs=[];self.run_enforce();self.assertNotIn('deny '+IP+';',self.deny.read_text());self.assertEqual(self.messages,[])
    def test_dynamic_self_ipv6_is_protected_even_if_policy_is_stale(self):
        import ipaddress
        address='2001:4860:1234::123';self.logs=incident(address)
        with patch.object(helper,'local_protected_networks',return_value=[ipaddress.ip_network(address)]):self.run_enforce()
        self.assertEqual(self.kernel,set())
    def test_origin_dns_guard_allows_both_direct_own_families(self):
        original=load('scanner_autoban_dns','scanner-autoban.py');data=config();data['originIps'].append('2001:4860:1234::1')
        output='46.62.227.229 STREAM form.tencorp.uz\n2001:4860:1234::1 STREAM form.tencorp.uz\n'
        with patch.object(original,'command',return_value=SimpleNamespace(stdout=output)):
            self.assertTrue(original.origin_is_direct(data))
    def test_activation_notice_is_truthful_and_deduplicated(self):
        with patch.object(helper,'telegram_text') as send,contextlib.redirect_stdout(io.StringIO()):
            helper.announce_enabled();helper.announce_enabled()
        self.assertEqual(send.call_count,1);self.assertIn('автоблокировка включена',send.call_args.args[0]);self.assertNotIn('IP:',send.call_args.args[0])
    def test_historical_replay_accepts_real_nginx_timestamps_without_effects(self):
        p=self.root/'replay.json'
        requests=[]
        for e in incident():
            stamp=datetime.datetime.fromtimestamp(e['time'],datetime.timezone.utc).strftime('%d/%b/%Y:%H:%M:%S +0000')
            requests.append({'time':stamp,'method':e['method'],'path':e['path'],'status':e['status']})
        atomic_json(p,{'sourceIp':IP,'requests':requests})
        with contextlib.redirect_stdout(io.StringIO()) as output:helper.replay(p)
        result=json.loads(output.getvalue());self.assertTrue(result['eligible']);self.assertFalse(result['firewallChanged']);self.assertEqual(self.kernel,set());self.assertEqual(self.messages,[])
    def test_ufw_show_added_implicit_to_any_owned_rules(self):
        self.assertEqual(helper.owned_rules("ufw deny from 8.8.8.8 comment 'tencorp-autoban-v1'\nufw deny from 9.9.9.9 to any comment 'tencorp-autoban-v1'\nufw deny from 1.1.1.1 comment 'manual'"), {'8.8.8.8','9.9.9.9'})
    def test_ipv6_kernel_rule_uses_fixed_tool_chain(self):
        with patch.object(helper.subprocess,'run',return_value=SimpleNamespace(returncode=0)) as run:
            # Unpatch kernel_rule only for this direct verification.
            original=load('scanner_autoban_original','scanner-autoban.py')
            self.assertTrue(original.kernel_rule('2001:4860:1234::123'))
            self.assertEqual(run.call_args.args[0],['/usr/sbin/ip6tables','-C','ufw6-user-input','-s','2001:4860:1234::123','-j','DROP'])


if __name__=='__main__':unittest.main()
