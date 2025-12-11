"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUrlPath = getUrlPath;
exports.JSONDecoder = JSONDecoder;
exports.normalizeHeaders = normalizeHeaders;
exports.extractURLPathParams = extractURLPathParams;
exports.deepEqual = deepEqual;
exports.matchURL = matchURL;
exports.normalizePath = normalizePath;
exports.joinURL = joinURL;
exports.checkHeaderValue = checkHeaderValue;
function getUrlPath(input) {
    if (!input || typeof input !== "string") {
        return "";
    }
    try {
        const url = new URL(input);
        return url.pathname;
    }
    catch (e) {
        if (input.startsWith("/")) {
            const queryIndex = input.indexOf("?");
            const hashIndex = input.indexOf("#");
            let endIndex = input.length;
            if (queryIndex !== -1 && (queryIndex < endIndex)) {
                endIndex = queryIndex;
            }
            if (hashIndex !== -1 && (hashIndex < endIndex)) {
                endIndex = hashIndex;
            }
            return input.substring(0, endIndex);
        }
    }
    return "";
}
function JSONDecoder(input = []) {
    try {
        return JSON.parse(Buffer.concat(input).toString());
    }
    catch (e) {
        console.error(e);
        return {};
    }
}
function normalizeHeaders(headers = {}) {
    const rtn = {};
    for (const h in headers) {
        rtn[h.toLowerCase()] = headers[h];
    }
    return rtn;
}
function extractURLPathParams(urlPattern, urlPath) {
    const rtn = {};
    const patternParts = urlPattern.split("/");
    const pathParts = urlPath.split("/");
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(":")) {
            rtn[patternParts[i].substring(1)] = pathParts[i];
        }
        else if (patternParts[i].startsWith("{") && patternParts[i].endsWith("}")) {
            const match = pathParts[i].match(patternParts[i]);
            if (match) {
                rtn[patternParts[i].substring(1, patternParts[i].length - 1)] = match[0];
            }
        }
    }
    return rtn;
}
function deepEqual(obj1, obj2) {
    if (obj1 === obj2) {
        return true;
    }
    if (typeof obj1 !== typeof obj2) {
        return false;
    }
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
        if (obj1.length !== obj2.length) {
            return false;
        }
        for (let i = 0; i < obj1.length; i++) {
            if (!deepEqual(obj1[i], obj2[i])) {
                return false;
            }
        }
        return true;
    }
    if (typeof obj1 === "object" && typeof obj2 === "object") {
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length) {
            return false;
        }
        for (const key of keys1) {
            if (!deepEqual(obj1[key], obj2[key])) {
                return false;
            }
        }
        return true;
    }
    return false;
}
function matchURL(pattern, urlPath) {
    const cleanedPattern = normalizePath(pattern);
    const cleanedPath = normalizePath(urlPath);
    if (cleanedPattern === cleanedPath) {
        return { found: true, pathParams: {} };
    }
    const params = {};
    const paramNames = [];
    const regexString = cleanedPattern.replace(/:((\w+))|{(((\w+)))}/g, (match, p1, p2, p3, p4) => {
        const paramName = p2 || p4;
        if (paramName) {
            paramNames.push(paramName);
            return '([^/]+)';
        }
        return match;
    });
    const regex = new RegExp(`^${regexString}$`);
    const match = cleanedPath.match(regex);
    if (match) {
        for (let i = 0; i < paramNames.length; i++) {
            params[paramNames[i]] = match[i + 1];
        }
        return { found: true, pathParams: params };
    }
    return { found: false, pathParams: undefined };
}
function normalizePath(url) {
    if (!url) {
        return "";
    }
    const cleanUrl = url.split(/[?#]/)[0];
    try {
        const urlObj = new URL(cleanUrl);
        return urlObj.pathname;
    }
    catch (e) {
        return cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`;
    }
}
function joinURL(...segments) {
    const validSegments = segments.filter(s => s && s.length > 0);
    if (validSegments.length === 0) {
        return '';
    }
    const joinedPath = validSegments.map((segment, index) => {
        let cleanSegment = segment;
        if (index < validSegments.length - 1) {
            cleanSegment = cleanSegment.replace(/\/$/, '');
        }
        if (index > 0) {
            cleanSegment = cleanSegment.replace(/^\//, '');
        }
        if (index === 0 && cleanSegment.includes('://')) {
            return cleanSegment;
        }
        return cleanSegment;
    }).join('/');
    return joinedPath;
}
function checkHeaderValue(header, name, value) {
    if (!header && typeof header !== "object") {
        return false;
    }
    const vparts = String(header[name] || "").split(";").map(s => s.trim());
    return vparts.includes(value) || vparts.includes(`"${value}"`);
}
