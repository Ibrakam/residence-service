import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: [],
  r2_buckets: [],
};

function decodePathLayers(value: string) {
  let decoded = value;
  // Legitimate URLs need one pass; a generous cap handles nested separator
  // encodings and then fails closed instead of doing unbounded quadratic work.
  for (let depth = 0; depth < 32; depth += 1) {
    if (!decoded.includes('%')) return decoded;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded.includes('%') ? null : decoded;
}

function canonicalRequestPath(requestUrl: string) {
  let pathname: string;
  if (/^https?:\/\//i.test(requestUrl)) {
    try {
      pathname = new URL(requestUrl).pathname;
    } catch {
      return null;
    }
  } else {
    // Node's request.url is normally origin-form. Parsing a leading `//` with
    // URL() would misread its first segment as a hostname and lose the path.
    pathname = requestUrl.split(/[?#]/, 1)[0] || '/';
  }

  const decoded = decodePathLayers(pathname);
  if (decoded === null) return null;
  const normalized = decoded.normalize('NFKC');
  if (/[\0-\x1f\x7f]/.test(normalized)) return null;

  const segments: string[] = [];
  for (const segment of normalized.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`.toLowerCase();
}

function containsCanonicalPath(pathname: string, target: string) {
  return pathname === target || pathname.endsWith(target) || pathname.includes(`${target}/`);
}

function isRegnumPrivatePath(pathname: string) {
  const dataPath = /\/data\/(regnum-plaza[^/]*)(?:\/|$)/.exec(pathname);
  return containsCanonicalPath(pathname, '/source/regnum-plaza')
    || Boolean(dataPath && dataPath[1] !== 'regnum-plaza-client.json')
    || containsCanonicalPath(pathname, '/app/api/regnum-plaza-lead')
    || /\/scripts\/[^/]*regnum-plaza[^/]*(?:\/|$)/.test(pathname);
}

function isSunPrivatePath(pathname: string) {
  const dataPath = /\/data\/(sun[^/]*)(?:\/|$)/.exec(pathname);
  return containsCanonicalPath(pathname, '/source/sun')
    || Boolean(dataPath && dataPath[1] !== 'sun-client.json')
    || containsCanonicalPath(pathname, '/app/api/sun-lead')
    || /\/scripts\/[^/]*sun[^/]*(?:\/|$)/.test(pathname);
}

function regnumPrivateSourceGuard() {
  return {
    name: 'regnum-private-source-guard',
    enforce: 'pre' as const,
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        const pathname = canonicalRequestPath(request.url ?? '/');
        const fsPath = pathname?.startsWith('/@fs/') ? pathname.slice(4) : pathname;
        if (pathname === null
          || isRegnumPrivatePath(pathname)
          || isSunPrivatePath(pathname)
          || (fsPath !== null && (isRegnumPrivatePath(fsPath) || isSunPrivatePath(fsPath)))) {
          response.statusCode = 404;
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end('Not found');
          return;
        }
        next();
      });
    },
  };
}

function redactBuildMachineProxyPath() {
  const proxySourcePath = `${process.cwd().replaceAll('\\', '/')}/proxy.ts`;
  return {
    name: 'redact-build-machine-proxy-path',
    apply: 'build' as const,
    enforce: 'post' as const,
    renderChunk(code: string) {
      if (!code.includes(proxySourcePath)) return null;
      return { code: code.replaceAll(proxySourcePath, 'proxy.ts'), map: null };
    },
  };
}

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      regnumPrivateSourceGuard(),
      redactBuildMachineProxyPath(),
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
