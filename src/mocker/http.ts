import * as http from "http";
import { anyObjectToRecord, searchParamsToRecord } from "../utils";
import { RequestOptions } from "./types";

export function readRequestOptions(req: http.IncomingMessage): Promise<RequestOptions> {
    return new Promise<RequestOptions>((resolve, reject) => {
        const fullUrl = req.url || "";
        const [urlPath, queryString] = fullUrl.split("?");
        const queryParams = searchParamsToRecord(new URLSearchParams(queryString));
        const requestHeaders = anyObjectToRecord(req.headers);
        const body: Uint8Array[] = [];

        req.on("data", (chunk) => body.push(chunk));

        req.on("end", () => {
            const payload: RequestOptions = {
                urlPath: urlPath,
                query: queryParams,
                headers: requestHeaders,
                body: body,
                method: req.method || "GET",
            }

            resolve(payload);
        });

        req.on("error", (err) => {
            reject(err);
        });
    });
}
