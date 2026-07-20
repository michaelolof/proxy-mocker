import { httpProxyMiddlewarePlugin } from "./http-proxy-middleware-plugin"
import { AnyProxyMiddlewarePlugin } from "./types"

export const HttpProxyMiddlewarePlugin: AnyProxyMiddlewarePlugin = httpProxyMiddlewarePlugin;

export const ViteProxyConfigurePlugin: AnyProxyMiddlewarePlugin = httpProxyMiddlewarePlugin


