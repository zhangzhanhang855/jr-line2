const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: true,
    credentials: true // 允许跨域携带安全 Cookie 凭证
}));

app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: "healthy", message: "JR Cyber-Grid Full-Traffic Gateway Operational!" });
});

// 1. 网页 HTML 全量劫持与重写网关
app.post('/api/proxy', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    try {
        // 获取当前请求应该使用哪一个后端域名来中转后续资源
        const hostHeader = req.headers.host || `localhost:${PORT}`;
        const currentGatewayBase = `${req.protocol}://${hostHeader}`;

        console.log(`[Cyber Tunnel] Grabbing full page: ${url}`);
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

        // 👉 拦截层一：静态 DOM 属性深度重写 (全量劫持图片、样式表、脚本、音视频)
        // 匹配 HTML 中所有的 src="..." 或 href="..."，并强制将它们代理化
        const proxyGatewayUrl = `${currentGatewayBase}/api/resource-gateway?url=`;
        
        html = html.replace(/(<(?:img|audio|video|source|link|script|p|div|a)[^>]*?(?:src|href|data-src)=["'])([^"']*)(["'][^>]*>)/gi, (match, p1, p2, p3) => {
            let originalUrl = p2.trim();
            if (!originalUrl || originalUrl.startsWith('data:') || originalUrl.startsWith('#') || originalUrl.startsWith('javascript:')) return match;

            // 补全相对路径
            let absoluteUrl = originalUrl;
            if (!/^https?:\/\//i.test(originalUrl)) {
                try { absoluteUrl = new URL(originalUrl, baseUrl).href; } catch(e) { return match; }
            }

            // 跳过已经是代理接口的链接，防止死循环
            if (absoluteUrl.includes('/api/resource-gateway')) return match;

            return `${p1}${proxyGatewayUrl}${encodeURIComponent(absoluteUrl)}${p3}`;
        });

        // 👉 拦截层二：动态注入脚本，捕获网页运行时产生的动态图片、异步多媒体流和 Cookie 
        const injectionScript = `
        <head>
            <script>
                (function() {
                    window._targetOrigin = "${targetOrigin}";
                    window._gatewayBase = "${currentGatewayBase}";
                    
                    // 核心拦截转换函数
                    function wrapUrl(url) {
                        if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:') || url.includes('/api/resource-gateway')) return url;
                        let absoluteUrl = url.startsWith('http') ? url : new URL(url, window._targetOrigin).href;
                        return window._gatewayBase + "/api/resource-gateway?url=" + encodeURIComponent(absoluteUrl);
                    }

                    // 1. 劫持原生的 fetch 异步请求 (全量代理网页动态图片和特效流)
                    const originalFetch = window.fetch;
                    window.fetch = async function(...args) {
                        if (typeof args[0] === 'string') {
                            args[0] = wrapUrl(args[0]);
                        }
                        return originalFetch.apply(this, args);
                    };

                    // 2. 劫持原生的 XMLHttpRequest (全量代理传统的 AJAX 数据流量)
                    const originalOpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                        if (typeof url === 'string') {
                            url = wrapUrl(url);
                        }
                        return originalOpen.call(this, method, url, ...rest);
                    };

                    // 3. 劫持 DOM 节点的 src 赋值行为 (捕获 JS 动态生成的 <img> 和 <audio>)
                    const originalSetAttribute = Element.prototype.setAttribute;
                    Element.prototype.setAttribute = function(name, value) {
                        if ((name === 'src' || name === 'href') && value) {
                            value = wrapUrl(value);
                        }
                        return originalSetAttribute.call(this, name, value);
                    };

                    // 4. 劫持 window.open
                    window.open = function(url) {
                        if (url) {
                            window.parent.postMessage({ type: 'OPEN_NEW_TAB', url: wrapUrl(url) }, '*');
                        }
                        return null; 
                    };

                    // 5. 粉碎防内嵌劫持
                    try {
                        const preventEscape = { get: function() { return window; }, set: function() { return true; } };
                        Object.defineProperty(window, 'top', preventEscape);
                        Object.defineProperty(window, 'parent', preventEscape);
                    } catch(e){}
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

// 2. 终极海外全量流体透明网关 (代理图片、CSS、JS、音频、视频、字体、及 Cookie 洗白)
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
            // 🌟 模拟持久化 Cookie：自动将目标大厂回传的 Cookie 重写为你的当前域名，存入本地浏览器
            cookieDomainRewrite: {
                "*": req.hostname 
            },
            on: {
                proxyReq: (proxyReq) => {
                    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                    proxyReq.setHeader('Referer', urlObj.origin);
                },
                proxyRes: (proxyRes) => {
                    // 粉碎所有的安全和防内嵌防跨域限制头
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
    console.log(`Full-Traffic Gateway running on port ${PORT}`);
});
