// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License

import { BotTelemetryClient, NullTelemetryClient } from './botTelemetryClient';
import { Middleware } from './middlewareSet';
import { TurnContext } from './turnContext';
import {
    Activity,
    ActivityTypes,
    ConversationReference,
    ResourceResponse,
    TeamsChannelData,
} from 'botframework-schema';
import { TelemetryConstants } from './telemetryConstants';

// Internal helper duplicated from
// https://github.com/microsoft/botbuilder-js/commit/9277f901701ef270cf5af089e37e7aa7ab2579e1
function isTeamsChannelData(channelData: unknown): channelData is TeamsChannelData {
    return typeof channelData === 'object';
}

/**
 * Middleware for logging incoming, outgoing, updated or deleted Activity messages.
 * Uses the botTelemetryClient interface.
 */
export class TelemetryLoggerMiddleware implements Middleware {
    /**
     * The name of the event when when new message is received from the user.
     */
    public static readonly botMsgReceiveEvent: string = 'BotMessageReceived';

    /**
     * The name of the event when a message is updated by the bot.
     */
    public static readonly botMsgSendEvent: string = 'BotMessageSend';

    /**
     * The name of the event when a message is updated by the bot.
     */
    public static readonly botMsgUpdateEvent: string = 'BotMessageUpdate';

    /**
     * The name of the event when a message is deleted by the bot.
     */
    public static readonly botMsgDeleteEvent: string = 'BotMessageDelete';

    private readonly _telemetryClient: BotTelemetryClient;

    // tslint:disable:variable-name
    private readonly _logPersonalInformation: boolean;
    // tslint:enable:variable-name

    /**
     * Initializes a new instance of the TelemetryLoggerMiddleware class.
     * @param telemetryClient The BotTelemetryClient used for logging.
     * @param logPersonalInformation (Optional) Enable/Disable logging original message name within Application Insights.
     */
    constructor(telemetryClient: BotTelemetryClient, logPersonalInformation = false) {
        this._telemetryClient = telemetryClient || new NullTelemetryClient();
        this._logPersonalInformation = logPersonalInformation;
    }

    /**
     * Gets a value indicating whether determines whether to log personal information that came from the user.
     */
    public get logPersonalInformation(): boolean {
        return this._logPersonalInformation;
    }

    /**
     * Gets the currently configured botTelemetryClient that logs the events.
     */
    public get telemetryClient(): BotTelemetryClient {
        return this._telemetryClient;
    }

    /**
     * Logs events based on incoming and outgoing activities using the botTelemetryClient class.
     * @param context The context object for this turn.
     * @param next The delegate to call to continue the bot middleware pipeline
     */
    public async onTurn(context: TurnContext, next: () => Promise<void>): Promise<void> {
        if (context === null) {
            throw new Error('context is null');
        }

        // log incoming activity at beginning of turn
        if (context.activity !== null) {
            const activity: Activity = context.activity;

            // Log Bot Message Received
            await this.onReceiveActivity(activity);
        }

        // hook up onSend pipeline
        context.onSendActivities(
            async (
                ctx: TurnContext,
                activities: Partial<Activity>[],
                nextSend: () => Promise<ResourceResponse[]>
            ): Promise<ResourceResponse[]> => {
                // run full pipeline
                const responses: ResourceResponse[] = await nextSend();
                activities.forEach(async (act: Partial<Activity>) => {
                    await this.onSendActivity(<Activity>act);
                });

                return responses;
            }
        );

        // hook up update activity pipeline
        context.onUpdateActivity(
            async (ctx: TurnContext, activity: Partial<Activity>, nextUpdate: () => Promise<void>) => {
                // run full pipeline
                const response: void = await nextUpdate();

                await this.onUpdateActivity(<Activity>activity);

                return response;
            }
        );

        // hook up delete activity pipeline
        context.onDeleteActivity(
            async (ctx: TurnContext, reference: Partial<ConversationReference>, nextDelete: () => Promise<void>) => {
                // run full pipeline
                await nextDelete();

                const deletedActivity: Partial<Activity> = TurnContext.applyConversationReference(
                    {
                        type: ActivityTypes.MessageDelete,
                        id: reference.activityId,
                    },
                    reference,
                    false
                );
                await this.onDeleteActivity(<Activity>deletedActivity);
            }
        );

        if (next !== null) {
            await next();
        }
    }

    /**
     * Invoked when a message is received from the user.
     * Performs logging of telemetry data using the IBotTelemetryClient.TrackEvent() method.
     * The event name logged is "BotMessageReceived".
     * @param activity Current activity sent from user.
     */
    protected async onReceiveActivity(activity: Activity): Promise<void> {
        this.telemetryClient.trackEvent({
            name: TelemetryLoggerMiddleware.botMsgReceiveEvent,
            properties: await this.fillReceiveEventProperties(activity),
        });
    }

    /**
     * Invoked when the bot sends a message to the user.
     * Performs logging of telemetry data using the botTelemetryClient.trackEvent() method.
     * The event name logged is "BotMessageSend".
     * @param activity Last activity sent from user.
     */
    protected async onSendActivity(activity: Activity): Promise<void> {
        this.telemetryClient.trackEvent({
            name: TelemetryLoggerMiddleware.botMsgSendEvent,
            properties: await this.fillSendEventProperties(<Activity>activity),
        });
    }

    /**
     * Invoked when the bot updates a message.
     * Performs logging of telemetry data using the botTelemetryClient.trackEvent() method.
     * The event name used is "BotMessageUpdate".
     * @param activity
     */
    protected async onUpdateActivity(activity: Activity): Promise<void> {
        this.telemetryClient.trackEvent({
            name: TelemetryLoggerMiddleware.botMsgUpdateEvent,
            properties: await this.fillUpdateEventProperties(<Activity>activity),
        });
    }

    /**
     * Invoked when the bot deletes a message.
     * Performs logging of telemetry data using the botTelemetryClient.trackEvent() method.
     * The event name used is "BotMessageDelete".
     * @param activity
     */
    protected async onDeleteActivity(activity: Activity): Promise<void> {
        this.telemetryClient.trackEvent({
            name: TelemetryLoggerMiddleware.botMsgDeleteEvent,
            properties: await this.fillDeleteEventProperties(<Activity>activity),
        });
    }

    /**
     * Fills the Application Insights Custom Event properties for BotMessageReceived.
     * These properties are logged in the custom event when a new message is received from the user.
     * @param activity Last activity sent from user.
     * @param telemetryProperties Additional properties to add to the event.
     * @returns A dictionary that is sent as "Properties" to botTelemetryClient.trackEvent method.
     */
    protected async fillReceiveEventProperties(
        activity: Activity,
        telemetryProperties?: { [key: string]: string }
    ): Promise<{ [key: string]: string }> {
        const properties: { [key: string]: string } = {};

        if (activity) {
            properties[TelemetryConstants.fromIdProperty] = activity.from && activity.from.id ? activity.from.id : '';
            properties[TelemetryConstants.conversationNameProperty] =
                activity.conversation && activity.conversation.name ? activity.conversation.name : '';
            properties[TelemetryConstants.localeProperty] = activity.locale || '';
            properties[TelemetryConstants.recipientIdProperty] =
                activity.recipient && activity.recipient.id ? activity.recipient.id : '';
            properties[TelemetryConstants.recipientNameProperty] =
                activity.recipient && activity.recipient.name ? activity.recipient.name : '';

            // Use the LogPersonalInformation flag to toggle logging PII data, text and user name are common examples
            if (this.logPersonalInformation) {
                if (activity.from && activity.from.name && activity.from.name.trim()) {
                    properties[TelemetryConstants.fromNameProperty] = activity.from ? activity.from.name : '';
                }

                if (activity.text && activity.text.trim()) {
                    properties[TelemetryConstants.textProperty] = activity.text;
                }

                if (activity.speak && activity.speak.trim()) {
                    properties[TelemetryConstants.speakProperty] = activity.speak;
                }
            }

            // Additional Properties can override "stock" properties.
            if (telemetryProperties) {
                return Object.assign({}, properties, telemetryProperties);
            }
        }

        this.populateAdditionalChannelProperties(activity, properties);

        // Additional Properties can override "stock" properties.
        if (telemetryProperties) {
            return Object.assign({}, properties, telemetryProperties);
        }

        return properties;
    }

    /**
     * Fills the Application Insights Custom Event properties for BotMessageSend.
     * These properties are logged in the custom event when a response message is sent by the Bot to the user.
     * @param activity - Last activity sent from user.
     * @param telemetryProperties Additional properties to add to the event.
     * @returns A dictionary that is sent as "Properties" to botTelemetryClient.trackEvent method.
     */
    protected async fillSendEventProperties(
        activity: Activity,
        telemetryProperties?: { [key: string]: string }
    ): Promise<{ [key: string]: string }> {
        const properties: { [key: string]: string } = {};

        if (activity) {
            properties[TelemetryConstants.replyActivityIdProperty] = activity.replyToId || '';
            properties[TelemetryConstants.recipientIdProperty] =
                activity.recipient && activity.recipient.id ? activity.recipient.id : '';
            properties[TelemetryConstants.conversationNameProperty] =
                activity.conversation && activity.conversation.name ? activity.conversation.name : '';
            properties[TelemetryConstants.localeProperty] = activity.locale || '';

            // Use the LogPersonalInformation flag to toggle logging PII data, text and user name are common examples
            if (this.logPersonalInformation) {
                if (activity.recipient && activity.recipient.name && activity.recipient.name.trim()) {
                    properties[TelemetryConstants.recipientNameProperty] = activity.recipient.name;
                }

                if (activity.text && activity.text.trim()) {
                    properties[TelemetryConstants.textProperty] = activity.text;
                }

                if (activity.speak && activity.speak.trim()) {
                    properties[TelemetryConstants.speakProperty] = activity.speak;
                }

                if (activity.attachments && activity.attachments.length > 0) {
                    properties[TelemetryConstants.attachmentsProperty] = JSON.stringify(activity.attachments);
                }
            }

            // Additional Properties can override "stock" properties.
            if (telemetryProperties) {
                return Object.assign({}, properties, telemetryProperties);
            }
        }

        return properties;
    }

    /**
     * Fills the event properties for BotMessageUpdate.
     * These properties are logged when an activity message is updated by the Bot.
     * For example, if a card is interacted with by the use, and the card needs to be updated to reflect
     * some interaction.
     * @param activity - Last activity sent from user.
     * @param telemetryProperties Additional properties to add to the event.
     * @returns A dictionary that is sent as "Properties" to botTelemetryClient.trackEvent method.
     */
    protected async fillUpdateEventProperties(
        activity: Activity,
        telemetryProperties?: { [key: string]: string }
    ): Promise<{ [key: string]: string }> {
        const properties: { [key: string]: string } = {};

        if (activity) {
            properties[TelemetryConstants.recipientIdProperty] =
                activity.recipient && activity.recipient.id ? activity.recipient.id : '';
            properties[TelemetryConstants.conversationIdProperty] =
                activity.conversation && activity.conversation.id ? activity.conversation.id : '';
            properties[TelemetryConstants.conversationNameProperty] =
                activity.conversation && activity.conversation.name ? activity.conversation.name : '';
            properties[TelemetryConstants.localeProperty] = activity.locale || '';

            // Use the LogPersonalInformation flag to toggle logging PII data, text is a common example
            if (this.logPersonalInformation && activity.text && activity.text.trim()) {
                properties[TelemetryConstants.textProperty] = activity.text;
            }

            // Additional Properties can override "stock" properties.
            if (telemetryProperties) {
                return Object.assign({}, properties, telemetryProperties);
            }
        }

        return properties;
    }

    /**
     * Fills the Application Insights Custom Event properties for BotMessageDelete.
     * These properties are logged in the custom event when an activity message is deleted by the Bot.  This is a relatively rare case.
     * @param activity - Last activity sent from user.
     * @param telemetryProperties Additional properties to add to the event.
     * @returns A dictionary that is sent as "Properties" to botTelemetryClient.trackEvent method.
     */
    protected async fillDeleteEventProperties(
        activity: Activity,
        telemetryProperties?: { [key: string]: string }
    ): Promise<{ [key: string]: string }> {
        const properties: { [key: string]: string } = {};

        if (activity) {
            properties[TelemetryConstants.channelIdProperty] = activity.channelId || '';
            properties[TelemetryConstants.recipientIdProperty] =
                activity.recipient && activity.recipient.id ? activity.recipient.id : '';
            properties[TelemetryConstants.conversationIdProperty] =
                activity.conversation && activity.conversation.id ? activity.conversation.id : '';
            properties[TelemetryConstants.conversationNameProperty] =
                activity.conversation && activity.conversation.name ? activity.conversation.name : '';

            // Additional Properties can override "stock" properties.
            if (telemetryProperties) {
                return Object.assign({}, properties, telemetryProperties);
            }
        }

        return properties;
    }

    /**
     * @private
     */
    private populateAdditionalChannelProperties(activity: Activity, properties?: { [key: string]: string }): void {
        if (activity) {
            const channelData = activity.channelData;
            switch (activity.channelId) {
                case 'msteams':
                    properties['TeamsUserAadObjectId'] = activity.from ? activity.from.aadObjectId : '';

                    if (isTeamsChannelData(channelData)) {
                        properties['TeamsTenantId'] = channelData.tenant ? channelData.tenant.id : '';
                        properties['TeamsTeamInfo'] = channelData.team && JSON.stringify(channelData.team);
                    }

                    break;
                default:
                    break;
            }
        }
    }
}
