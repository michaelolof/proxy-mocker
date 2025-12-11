"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFuncy = extractFuncy;
exports.wait = wait;
exports.waitBlock = waitBlock;
exports.searchParamsToRecord = searchParamsToRecord;
exports.anyObjectToRecord = anyObjectToRecord;
function extractFuncy(valOrFn) {
    if (valOrFn === undefined) {
        return undefined;
    }
    else if (typeof valOrFn === "function") {
        //@ts-expect-error "You don't know what you're saying" 
        return valOrFn();
    }
    else {
        return valOrFn;
    }
}
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function waitBlock(ms) {
    const start = performance.now();
    const end = start + ms;
    while (performance.now() < end) {
    }
}
function searchParamsToRecord(params) {
    const result = {};
    for (const [key, value] of params.entries()) {
        if (!(key in result)) {
            result[key] = value;
        }
    }
    return result;
}
function anyObjectToRecord(obj) {
    const result = {};
    for (const key in obj) {
        if (key in obj && obj.hasOwnProperty(key)) {
            //@ts-expect-error "You don't know what you're saying"
            result[key] = obj[key];
        }
    }
    return result;
}
