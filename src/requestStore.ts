"use strict";

import { HttpRequest } from './models/httpRequest';

export class RequestStore {
    private static cache: Map<string, HttpRequest> = new Map<string, HttpRequest>();
    private static cancelledRequestIds: Set<string> = new Set<string>();
    private static completedRequestIds: Set<string> = new Set<string>();
    private static currentRequestId: string;

    public static add(requestId: string, request: HttpRequest) {
        if (request && requestId) {
            RequestStore.cache.set(requestId, request);
            RequestStore.currentRequestId = requestId;
        }
    }

    public static getLatest(): HttpRequest {
        if (RequestStore.cache.has(RequestStore.currentRequestId)) {
            return RequestStore.cache.get(RequestStore.currentRequestId);
        } else {
            return null;
        }
    }

    public static cancel(requestId: string = null) {
        requestId = requestId || RequestStore.currentRequestId;
        if (!RequestStore.cancelledRequestIds.has(requestId)) {
            RequestStore.cancelledRequestIds.add(requestId);
        }
    }

    public static isCancelled(requestId: string) {
        return requestId && RequestStore.cancelledRequestIds.has(requestId);
    }

    public static complete(requestId: string) {
        if (requestId) {
            RequestStore.completedRequestIds.add(requestId);
        }
    }

    public static isCompleted(requestId: string = null) {
        requestId = requestId || RequestStore.currentRequestId;
        return RequestStore.completedRequestIds.has(requestId);
    }
}