const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: true,
    credentials: true 
}));

app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: "healthy", message: "JR Absolute-Lock Gateway Operational!" });
});

// 1. 网页 HTML 全量劫持与强制闭环网关
app.post('/api/proxy', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    try {
        const hostHeader = req.headers.host || `localhost:${PORT}`;
        const currentGatewayBase = `${req.protocol}://${hostHeader}`;

        console.log(`[Absolute-Lock Tunnel] Fetching & Restricting: ${url}`);
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 15000
        });

        let html = response.data;
        const urlObj = new URL(url);
        const targetOrigin = urlObj.origin; 
        const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

        const proxyGatewayUrl = `${currentGatewayBase}/api/resource-gateway?url=`;

        // 👉 【核心加固一】：在后端直接将所有 <a> 标签的 target 属性暴力抹除或强制设为 _self 
        // 彻底切断原站代码试图通过 target="_blank" 弹开新页面的原生通路
        html = html.replace(/<a\s+([^>]*?)target=["']?_blank["']?([^>]*?)>/gi, '<a $1 target="_self" $2>');

        // 👉 【核心加固二】：广谱静态路由拦截
        // 任何被解析出的静态属性，如果是完整的 http/https 或者是相对路径，全部重定向到 Render 网关
        html = html.replace(/(<(?:img|audio|video|source|link|script|p|div|a|form)[^>]*?(?:src|href|data-src|action)=["'])([^"']*)(["'][^>]*>)/gi, (match, p1, p2, p3) => {
            let originalUrl = p2.trim();
            if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('#') || originalUrl.startsWith('javascript:')) return match;

            let absoluteUrl = originalUrl;
            if (!/^https?:\/\//i.test(originalUrl)) {
                try { absoluteUrl = new URL(originalUrl, baseUrl).href; } catch(e) { return match; }
            }

            if (absoluteUrl.includes('/api/resource-gateway')) return match;

            // 如果是常规的跳转超链接，我们让他点击后，依然由我们的 HTML 拦截器加载（让结果也保留在沙箱中）
            if (p1.includes('href') && (match.toLowerCase().startsWith('<a ') || match.toLowerCase().startsWith('<form '))) {
                return `${p1}${proxyGatewayUrl}${encodeURIComponent(absoluteUrl)}${p3}`;
            }

            return `${p1}${proxyGatewayUrl}${encodeURIComponent(absoluteUrl)}${p3}`;
        });

        // 👉 【核心加固三】：注入深度内存隔离锁
        // 通过监听单页应用（SPA）最喜欢的历史记录变更（History API）和全局捕获，封锁动态逃逸
        const injectionScript = `
        <head>
            <script>
                (function() {
                    window._targetOrigin = "${targetOrigin}";
                    window._gatewayBase = "${currentGatewayBase}";
                    
                    function wrapUrl(url) {
                        if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/resource-gateway')) return url;
                        let absoluteUrl = url.startsWith('http') ? url : new URL(url, window._targetOrigin).href;
                        return window._gatewayBase + "/api/resource-gateway?url=" + encodeURIComponent(absoluteUrl);
                    }

                    // 1. 全局监听点击事件：采用最高捕获阶段（true），在原网页所有 JS 之前拦截
                    document.addEventListener('click', function(e) {
                        const target = e.target.closest('a');
                        if (target && target.href) {
                            e.preventDefault(); // 强行按下刹车
                            e.stopPropagation(); // 阻止事件向上冒泡
                            
                            let rawHref = target.getAttribute('href');
                            let absoluteUrl = (rawHref.startsWith('http')) ? rawHref : new URL(rawHref, window._targetOrigin).href;
                            
                            // 通知最外层父框架，由父框架开新标签或者在当前标签切页
                            window.parent.postMessage({ type: 'OPEN_NEW_TAB', url: absoluteUrl }, '*');
                        }
                    }, true);

                    // 2. 彻底接管 History 路由变换（防止单页应用如 Gemini、Google 动态重写地址栏逃逸）
                    const originalPushState = history.pushState;
                    history.pushState = function(state, title, url) {
                        if (url && !url.includes('/api/resource-gateway')) {
                            // 阻止网页自己无刷新修改路径从而脱离网关
                            console.log('[Lock] Blocked pushState bypass.');
                        }
                        return originalPushState.apply(this, arguments);
                    };

                    // 3. 拦截任何 window.location.assign 或 replace 的动作
                    // 利用 Object.defineProperty 将 location 保护起来（防高层强杀外壳）
                    try {
                        const preventEscape = { get: function() { return window; }, set: function() { return true; } };
                        Object.defineProperty(window, 'top', preventEscape);
                        Object.defineProperty(window, 'parent', preventEscape);
                    } catch(e){}

                    // 4. 万能异步网络流拦截
                    const originalFetch = window.fetch;
                    window.fetch = async function(...args) {
                        if (typeof args[0] === 'string') { args[0] = wrapUrl(args[0]); }
                        return originalFetch.apply(this, args);
                    };

                    const originalOpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                        if (typeof url === 'string') { url = wrapUrl(url); }
                        return originalOpen.call(this, method, url, ...rest);
                    };
                })();
            </script>
            <base href="${targetOrigin}/">
        `;

        if (html.includes('<head>')) {
            html = html.replace('<head>', injectionScript);
        } else {
            html = html.replace('<html>', `<html>${injectionScript}`);
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        res.status(500).send(`<div style="padding:40px;color:red;text-align:center;">Gateway Error: ${error.message}</div>`);
    }
});

// 2. 媒体/脚本/样式/全量资源网关（透传处理）
app.use('/api/resource-gateway', (req, res, next) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL is required');

    try {
        const decodedUrl = decodeURIComponent(url);
        const urlObj = new URL(decodedUrl);

        const resourceProxy = createProxyMiddleware({
            target: urlObj.origin,
            changeOrigin: true,
            pathRewrite: () => urlObj.pathname + urlObj.search,
            cookieDomainRewrite: { "*": req.hostname },
            on: {
                proxyReq: (proxyReq) => {
                    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                    proxyReq.setHeader('Referer', urlObj.origin);
                },
                proxyRes: (proxyRes) => {
                    // 粉碎所有反内嵌安全头
                    delete proxyRes.headers['x-frame-options'];
                    delete proxyRes.headers['content-security-policy'];
                    delete proxyRes.headers['cross-origin-opener-policy'];
                    delete proxyRes.headers['cross-origin-resource-policy'];

                    proxyRes.headers['Access-Control-Allow-Origin'] = proxyRes.req.headers.origin || '*';
                    proxyRes.headers['Access-Control-Allow-Credentials'] = 'true';
                }
            }
        });

        resourceProxy(req, res, next);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.listen(PORT, () => {
    console.log(`JR Absolute-Lock Gateway running on port ${PORT}`);
});
