'use strict';

export const ExtensionId: string = 'humao.rest-client';
export const AiKey: string = '45683c4a-6446-4b08-a73e-f1982e919936';
export const CSSFileName: string = 'rest-client.css';
export const CSSFolderName: string = 'styles';
export const ExtensionFolderName: string = '.rest-client';
export const HistoryFileName: string = 'history.json';
export const CookieFileName: string = 'cookie.json';
export const EnvironmentFileName: string = 'environment.json';
export const DefaultResponseDownloadFolderName: string = 'responses';
export const HistoryItemsMaxCount: number = 50;

export const NoEnvironmentSelectedName: string = 'c0cfe680-4fcd-4b71-a4ba-8cfaee57680a';

export const TimeStampVariableName = "$timestamp";
export const TimeStampVariableDescription = "Add a number of milliseconds between 1970/1/1 UTC Time and now. \
 You can also provide the offset with current time in the format {{$timestamp number string}}";
export const GuidVariableName = "$guid";
export const GuidVariableDescription = "Add a RFC 4122 v4 UUID";
export const RandomInt = "$randomInt";
export const RandomIntDescription = "Returns a random integer between min (included) and max (excluded)";

export const CommentIdentifiersRegex: RegExp = new RegExp('^\\s*(\#|\/\/)');