'use strict';

import { RestClientSettings } from './models/configurationSettings';
import * as Constants from './constants';
import * as appInsights from "applicationinsights";

appInsights.setup(Constants.AiKey)
    .setAutoCollectDependencies(false)
    .setAutoCollectPerformance(false)
    .setAutoCollectRequests(false)
    .setAutoDependencyCorrelation(false)
    .start();

export class Telemetry {
    private static readonly restClientSettings: RestClientSettings = new RestClientSettings();

    public static sendEvent(eventName: string, properties?: { [key: string]: string }) {
        try {
            if (Telemetry.restClientSettings.enableTelemetry) {
                appInsights.defaultClient.trackEvent({name: eventName, properties});
            }
        } catch {
        }
    }
}