"use strict";

export class HttpRequest {
    public constructor(public method: string, public url: string, public headers: { [key: string]: string }, public body: string) {
    }
}

export class SerializedHttpRequest extends HttpRequest {
    public startTime: number;
}