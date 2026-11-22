#!/usr/bin/env python3
import copy
import csv
import datetime as dt
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error

spec=importlib.util.spec_from_file_location('update_country',Path(__file__).with_name('update-country.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
TODAY=dt.date(2026,11,22)


class SmallLimits(m.Limits):
    min_rows=5
    max_rows=100
    min_family_rows=1
    min_countries=3
    min_uz_v4_ranges=1
    min_uz_v6_ranges=1
    min_v4_addresses=256
    max_v4_addresses=1_000_000
    min_v6_addresses=2**64
    max_v6_addresses=2**100


def rows():
    return [('1.0.0.0','1.0.0.255','AU'),('5.62.41.0','5.62.41.255','UZ'),('8.8.8.0','8.8.8.255','US'),('2001:4860::','2001:4860:0:ffff:ffff:ffff:ffff:ffff','US'),('2a00:abcd::','2a00:abcd:0:ffff:ffff:ffff:ffff:ffff','UZ')]


def encoded(data):
    stream=io.StringIO(newline='');csv.writer(stream,lineterminator='\n').writerows(data)
    return gzip.compress(stream.getvalue().encode('ascii'))


class Response:
    def __init__(self,url,data,headers=None):self.url=url;self.stream=io.BytesIO(data);self.headers={} if headers is None else headers
    def geturl(self):return self.url
    def read1(self,size):return self.stream.read(size)
    def __enter__(self):return self
    def __exit__(self,*_):self.stream.close()


class CountryTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.path=self.root/'source.csv.gz'
    def tearDown(self):self.temp.cleanup()
    def parse(self,data=None):
        self.path.write_bytes(encoded(rows() if data is None else data))
        return m.parse_database(self.path,'2026-11',TODAY,SmallLimits())
    def test_valid_both_families_and_sha(self):
        body,manifest,nets=self.parse();self.assertIn(b'5.62.41.0/24 1;',body);self.assertIn(b'2a00:abcd::/48 1;',body)
        self.assertEqual(manifest['recordCount'],5);self.assertEqual(manifest['uzRangeCounts'],{'4':1,'6':1})
        self.assertEqual(manifest['csvSHA256'],hashlib.sha256(gzip.decompress(self.path.read_bytes())).hexdigest())
        self.assertEqual(manifest['configSHA256'],hashlib.sha256(body).hexdigest());self.assertEqual(len(nets),2)
    def test_bad_csv_field_count_and_country(self):
        for bad in [('5.62.41.0','5.62.41.255','uz'),('5.62.41.0','5.62.41.255','QQ'),('5.62.41.0','5.62.41.255','UZ','1; deny all;')]:
            data=rows();data[1]=bad
            with self.assertRaises(m.ValidationError):self.parse(data)
    def test_overlap_unsorted_and_reversed(self):
        for change in ['overlap','unsorted','reverse','family']:
            data=rows()
            if change=='overlap':data[2]=('5.62.41.128','5.62.42.255','US')
            if change=='unsorted':data[0],data[1]=data[1],data[0]
            if change=='reverse':data[1]=('5.62.41.255','5.62.41.0','UZ')
            if change=='family':data[3],data[1]=data[1],data[3]
            with self.assertRaises(m.ValidationError):self.parse(data)
    def test_invalid_address_and_mixed_family(self):
        for item in [('999.1.2.3','5.62.41.255','UZ'),('05.62.41.0','5.62.41.255','UZ'),('5.62.41.0','::1','UZ'),('2a00:abcd::%eth0','2a00:abcd:0:ffff:ffff:ffff:ffff:ffff','UZ')]:
            data=rows();data[1]=item
            with self.assertRaises(m.ValidationError):self.parse(data)
    def test_uz_private_reserved_multicast_and_broad_ranges_rejected(self):
        data=rows()
        for low,high in [('10.0.0.0','10.0.0.255'),('127.0.0.0','127.0.0.255'),('198.51.100.0','198.51.100.255'),('224.0.0.0','224.0.0.255'),('1.0.0.0','223.255.255.255')]:
            data[1]=(low,high,'UZ');data.sort(key=lambda r:(m.address(r[0]).version,int(m.address(r[0]))))
            with self.assertRaises(m.ValidationError):self.parse(data)
            data=rows()
        for prefix in ['::/0','fc00::/7','fe80::/10','ff00::/8','2001:db8::/32','2002::/16','2a00::/16']:
            with self.assertRaises(m.ValidationError):m.validate_uz_network(m.ipaddress.ip_network(prefix),SmallLimits())
    def test_internal_non_global_overlap_not_hidden_by_global_endpoints(self):
        network=m.ipaddress.ip_network('96.0.0.0/4');self.assertTrue(network.network_address.is_global and network.broadcast_address.is_global)
        with self.assertRaises(m.ValidationError):m.validate_uz_network(network,SimpleNamespace(min_prefix_v4=0,min_prefix_v6=0))
    def test_missing_uz_or_country_coverage_rejected(self):
        data=[(a,b,'US' if country=='UZ' else country) for a,b,country in rows()]
        with self.assertRaises(m.ValidationError):self.parse(data)
        data=[(a,b,'UZ') for a,b,_ in rows()]
        with self.assertRaises(m.ValidationError):self.parse(data)
    def test_truncation_crc_and_bomb_fail_closed(self):
        self.path.write_bytes(encoded(rows())[:-5])
        with self.assertRaises(m.ValidationError):m.parse_database(self.path,'2026-11',TODAY,SmallLimits())
        self.path.write_bytes(gzip.compress(b'x'*1_000_000))
        with self.assertRaises(m.ValidationError):m.parse_database(self.path,'2026-11',TODAY,SmallLimits())
    def test_line_compressed_and_uncompressed_size_limits(self):
        self.path.write_bytes(encoded(rows()))
        with patch.object(m,'MAX_COMPRESSED',20):
            with self.assertRaises(m.ValidationError):m.parse_database(self.path,'2026-11',TODAY,SmallLimits())
        with patch.object(m,'MAX_UNCOMPRESSED',50):
            with self.assertRaises(m.ValidationError):m.parse_database(self.path,'2026-11',TODAY,SmallLimits())
    def test_only_current_or_previous_recent_month(self):
        self.assertEqual(m.permitted_months(dt.date(2027,1,1)),['2027-01','2026-12'])
        for value in ['2026-08','2026-12','2026-1','2026-13','2026-11;evil']:
            with self.assertRaises(m.ValidationError):m.validate_month(value,TODAY)
        self.assertEqual(m.validate_month('2026-10',TODAY),52)
    def test_output_is_only_canonical_network_allow_entries(self):
        body,_,_=self.parse()
        for line in body.decode().splitlines():
            if not line.startswith('#'):self.assertRegex(line,r'^[0-9a-f:./]+ 1;$')
    def test_existing_configuration_never_accepts_injected_directives(self):
        for body in [b'0.0.0.0/0 1;\n',b'5.62.41.0/24 1; deny all;\n',b'include /tmp/evil;\n',b'5.62.41.0/24 0;\n',b'']:
            with self.assertRaises(m.ValidationError):m.load_network_config(body)
    def test_change_guard_equivalent_and_large_changes(self):
        body,manifest,nets=self.parse();m.validate_change(manifest,nets,manifest,body)
        new=copy.deepcopy(manifest);new['uzRangeCounts']['4']=10
        with self.assertRaises(m.ValidationError):m.validate_change(new,nets,manifest,body)
        new=copy.deepcopy(manifest);new['uzAddressCounts']['4']='1000000'
        with self.assertRaises(m.ValidationError):m.validate_change(new,nets,manifest,body)
        moved=[m.ipaddress.ip_network('5.62.42.0/24'),nets[1]]
        with self.assertRaises(m.ValidationError):m.validate_change(manifest,moved,manifest,body)
        new=copy.deepcopy(manifest);new['sourceMonth']='2026-10'
        with self.assertRaises(m.ValidationError):m.validate_change(new,nets,manifest,body)
    def test_lkg_checksum_and_incomplete_metadata_rejected(self):
        body,manifest,nets=self.parse()
        with self.assertRaises(m.ValidationError):m.validate_change(manifest,nets,manifest,body+b'# changed')
        with self.assertRaises(m.ValidationError):m.validate_change(manifest,nets,None,body)
    def test_symdifference_counts_without_enumerating(self):
        a=[m.ipaddress.ip_network('5.62.40.0/24')];b=[m.ipaddress.ip_network('5.62.40.128/25')]
        self.assertEqual(m.changed_addresses(a,b),128);self.assertEqual(m.changed_addresses(a,a),0)


class DownloadTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.calls=[]
    def tearDown(self):self.temp.cleanup()
    def test_current_success(self):
        data=encoded(rows())
        def opener(request,timeout):self.calls.append(request.full_url);return Response(request.full_url,data,{'Content-Length':str(len(data))})
        path,month,fallback=m.download_source(self.root,TODAY,opener)
        self.assertEqual(month,'2026-11');self.assertFalse(fallback);self.assertEqual(path.read_bytes(),data);self.assertEqual(len(self.calls),1)
    def test_only_404_falls_back_to_previous(self):
        def opener(request,timeout):
            self.calls.append(request.full_url)
            if '2026-11' in request.full_url:raise urllib.error.HTTPError(request.full_url,404,'not published',{},None)
            return Response(request.full_url,encoded(rows()))
        _,month,fallback=m.download_source(self.root,TODAY,opener)
        self.assertEqual(month,'2026-10');self.assertTrue(fallback);self.assertEqual(len(self.calls),2)
    def test_network_403_500_never_use_old_release(self):
        for failure in [urllib.error.URLError('offline'),urllib.error.HTTPError('https://download.db-ip.com',403,'forbidden',{},None),urllib.error.HTTPError('https://download.db-ip.com',500,'error',{},None)]:
            self.calls=[]
            def opener(request,timeout):self.calls.append(request.full_url);raise failure
            with self.assertRaises(Exception):m.download_source(self.root,TODAY,opener)
            self.assertEqual(len(self.calls),1)
    def test_malformed_current_is_not_silently_replaced_by_previous(self):
        def opener(request,timeout):self.calls.append(request.full_url);return Response(request.full_url,b'not a valid gzip database')
        path,month,_=m.download_source(self.root,TODAY,opener)
        with self.assertRaises(m.ValidationError):m.parse_database(path,month,TODAY,SmallLimits())
        self.assertEqual(len(self.calls),1)
    def test_redirect_length_truncation_and_deadline_fail_closed(self):
        for data,headers,redirect in [(b'x'*50,{'Content-Length':'100'},False),(b'x'*50,{'Content-Length':str(m.MAX_COMPRESSED+1)},False),(b'x'*50,{},True)]:
            target=self.root/'x.gz'
            def opener(request,timeout):return Response('https://untrusted.invalid/file' if redirect else request.full_url,data,headers)
            with self.assertRaises(m.ValidationError):m.download_month('2026-11',target,TODAY,opener)
            self.assertFalse(target.exists())
        with patch.object(m.time,'monotonic',side_effect=[0,100]):
            with self.assertRaises(m.ValidationError):m.download_month('2026-11',self.root/'late.gz',TODAY,lambda r,timeout:Response(r.full_url,b'x'*50))
    def test_streaming_download_size_cap(self):
        with patch.object(m,'MAX_COMPRESSED',30):
            with self.assertRaises(m.ValidationError):m.download_month('2026-11',self.root/'big.gz',TODAY,lambda r,timeout:Response(r.full_url,b'x'*50))


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.target=self.root/'uz.conf';self.manifest=self.root/'manifest.json';self.state=self.root/'state';self.state.mkdir()
        self.source=self.root/'source.gz';self.source.write_bytes(encoded(rows()));self.body,self.data,self.nets=m.parse_database(self.source,'2026-11',TODAY,SmallLimits())
        self.target.write_bytes(self.body);self.manifest.write_bytes(m.metadata_bytes(self.data));self.calls=[]
        self.newbody=self.body.replace(b'# DB-IP Country Lite 2026-11;',b'# DB-IP Country Lite 2026-12;');self.newdata=copy.deepcopy(self.data);self.newdata['sourceMonth']='2026-12';self.newdata['configSHA256']=hashlib.sha256(self.newbody).hexdigest()
    def tearDown(self):self.temp.cleanup()
    def apply(self,body=None,data=None,runner=None):
        with patch.object(m.os,'geteuid',return_value=0):
            return m.apply_candidate(self.newbody if body is None else body,self.newdata if data is None else data,self.target,self.manifest,self.state,self.runner if runner is None else runner)
    def runner(self,args,**kwargs):self.calls.append(args);return SimpleNamespace(returncode=0)
    def test_success_atomic_pair_and_backup(self):
        result=self.apply();self.assertTrue(result['changed']);self.assertEqual(self.target.read_bytes(),self.newbody);self.assertEqual(json.loads(self.manifest.read_text())['configSHA256'],hashlib.sha256(self.newbody).hexdigest())
        self.assertEqual((Path(result['backup'])/'uz-networks.conf').read_bytes(),self.body);self.assertEqual(len(self.calls),2)
    def test_identical_month_does_not_reload_nginx(self):
        result=self.apply(self.body,self.data);self.assertFalse(result['changed']);self.assertEqual(self.calls,[])
    def test_nginx_validation_failure_restores_exact_lkg(self):
        def runner(args,**kwargs):
            self.calls.append(args)
            if len(self.calls)==1:raise subprocess.CalledProcessError(1,args)
            return SimpleNamespace(returncode=0)
        before=self.manifest.read_bytes()
        with self.assertRaises(subprocess.CalledProcessError):self.apply(runner=runner)
        self.assertEqual(self.target.read_bytes(),self.body);self.assertEqual(self.manifest.read_bytes(),before);self.assertEqual(len(self.calls),3)
    def test_reload_failure_restores_and_reloads_lkg(self):
        def runner(args,**kwargs):
            self.calls.append(args)
            if len(self.calls)==2:raise subprocess.CalledProcessError(1,args)
            return SimpleNamespace(returncode=0)
        with self.assertRaises(subprocess.CalledProcessError):self.apply(runner=runner)
        self.assertEqual(self.target.read_bytes(),self.body);self.assertEqual(len(self.calls),4)
    def test_invalid_candidate_never_touches_files(self):
        bad=copy.deepcopy(self.newdata);bad['uzRangeCounts']['4']=999
        before=self.manifest.read_bytes()
        with self.assertRaises(m.ValidationError):self.apply(data=bad)
        self.assertEqual(self.target.read_bytes(),self.body);self.assertEqual(self.manifest.read_bytes(),before);self.assertEqual(self.calls,[])
    def test_candidate_metadata_must_match_actual_config(self):
        bad=copy.deepcopy(self.newdata);bad['configSHA256']='0'*64
        with self.assertRaises(m.ValidationError):self.apply(data=bad)
        self.assertEqual(self.target.read_bytes(),self.body);self.assertEqual(self.calls,[])
    def test_no_automatic_initial_all_allow_config(self):
        self.target.unlink()
        with self.assertRaises(m.ValidationError):self.apply()
        self.assertFalse(self.target.exists());self.assertEqual(self.calls,[])


if __name__=='__main__':unittest.main()
