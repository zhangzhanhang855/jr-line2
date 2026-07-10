const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: true,
    credentials: true // 允许前端携带和接收跨域 Cookie
}));

app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: "healthy", message: "JR Cyber-Grid Gateway Server Running!" });
});

// 1. 网页主 HTML 骨架网关
app.post('/api/proxy', async (req, res) => {
    let { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    try {
        console.log(`[Cyber Tunnel] Gateway opening for HTML: ${url}`);
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
            },
            timeout: 15000
        });

        let html = response.data;
        const urlObj = new URL(url);
        const targetOrigin = urlObj.origin; 

        // 👉 极致注入：重写全局底层拦截
        // 确保所有动态图片、高级 JS 交互、表单提交，全部强制收拢走我们的通用流网关
        const injectionScript = `
        <head>
            <script>
                (function() {
                    window._targetOrigin = "${targetOrigin}";
                    
                    // 拦截新窗口弹窗
                    window.open = function(url) {
                        if (url) {
                            let absoluteUrl = url.startsWith('http') ? url : new URL(url, window._targetOrigin).href;
                            window.parent.postMessage({ type: 'OPEN_NEW_TAB', url: absoluteUrl }, '*');
                        }
                        return null; 
                    };

                    // 拦截链接点击
                    document.addEventListener('click', function(e) {
                        const target = e.target.closest('a');
                        if (target && target.href) {
                            e.preventDefault();
                            let absoluteUrl = target.href.startsWith('http') ? target.href : new URL(target.getAttribute('href'), window._targetOrigin).href;
                            window.parent.postMessage({ type: 'OPEN_NEW_TAB', url: absoluteUrl }, '*');
                        }
                    }, true);

                    // 伪造并欺骗高级大厂的防内嵌 JS 检查，彻底粉碎环境锁
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

// 2. 🌟 终极万能流量透明网关（处理所有图片、动态特效、JS、字体、以及 Cookie 注入）
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
            // 自动处理通过当前域发出的 Cookie，使其各归各家
            cookieDomainRewrite: {
                "*": req.hostname // 将大厂的目标域名 Cookie 强行洗白为你的 Render 域名 Cookie 存入浏览器！
            },
            on: {
                proxyReq: (proxyReq, proxyReqRaw) => {
                    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                    proxyReq.setHeader('Referer', urlObj.origin);
                },
                proxyRes: (proxyRes) => {
                    // 粉碎干扰大厂 JS 渲染和 Iframe 加载的全部恶性响应头
                    delete proxyRes.headers['x-frame-options'];
                    delete proxyRes.headers['content-security-policy'];
                    delete proxyRes.headers['cross-origin-opener-policy'];
                    delete proxyRes.headers['cross-origin-resource-policy'];

                    // 允许浏览器读取流式动态数据
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
    console.log(`JR Cyber-Grid Gateway Server running on port ${PORT}`);
});
