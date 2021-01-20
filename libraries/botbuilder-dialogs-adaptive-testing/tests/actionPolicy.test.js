const { createHash } = require('crypto');
const path = require('path');
const nock = require('nock');
const {
    ActivityTypes,
    ComponentRegistration,
    MessageFactory,
    SkillConversationIdFactoryBase,
    TurnContext,
} = require('botbuilder-core');
const { ResourceExplorer } = require('botbuilder-dialogs-declarative');
const { AdaptiveTestComponentRegistration, TestUtils, TestScript, ActionPolicyType, ActionPolicyValidator } = require('../lib');
const {
    AdaptiveComponentRegistration,
    skillConversationIdFactoryKey,
    skillClientKey,
} = require('botbuilder-dialogs-adaptive');


class MockSkillConversationIdFactory extends SkillConversationIdFactoryBase {
    constructor(opts = { useCreateSkillConversationId: false }) {
        super();
        this._conversationRefs = new Map();
        this.useCreateSkillConversationId = opts.useCreateSkillConversationId;
    }

    async createSkillConversationIdWithOptions(opts) {
        if (this.useCreateSkillConversationId) {
            return super.createSkillConversationIdWithOptions();
        }
        const key = createHash('md5')
            .update(opts.activity.conversation.id + opts.activity.serviceUrl)
            .digest('hex');

        const ref = this._conversationRefs.has(key);
        if (!ref) {
            this._conversationRefs.set(key, {
                conversationReference: TurnContext.getConversationReference(opts.activity),
                oAuthScope: opts.fromBotOAuthScope,
            });
        }
        return key;
    }

    async createSkillConversationId(convRef) {
        const key = createHash('md5')
            .update(convRef.conversation.id + convRef.serviceUrl)
            .digest('hex');

        const ref = this._conversationRefs.has(key);
        if (!ref) {
            this._conversationRefs.set(key, {
                conversationReference: convRef,
            });
        }
        return key;
    }

    async getConversationReference(skillConversationId) {
        return this._conversationRefs.get(skillConversationId);
    }

    async getSkillConversationReference(skillConversationId) {
        return this.getConversationReference(skillConversationId);
    }

    async deleteConversationReference() {
        /* not used in BeginSkill */
    }
}

class MockSkillBotFrameworkClient {
    async postActivity(fromBotId, toBotId, toUrl, serviceUrl, conversationId, activity) {
        let responseActivity = activity;

        if (activity.text.indexOf('skill') >= 0) {
            responseActivity = {
                type: 'message',
                text: 'This is the skill talking: hello',
            };
        }

        if (activity.text.indexOf('end') >= 0) {
            responseActivity = {
                type: ActivityTypes.EndOfConversation,
            };
        }

        return {
            status: 200,
            body: {
                activities: [responseActivity],
            },
        };
    }
}

class SetSkillConversationIdFactoryBaseMiddleware {
    async onTurn(context, next) {
        if (context.activity.type === ActivityTypes.Message) {
            context.turnState.set(skillConversationIdFactoryKey, new MockSkillConversationIdFactory());
            await next();
        }
    }
}

class SetSkillBotFrameworkClientMiddleware {
    async onTurn(context, next) {
        if (context.activity.type === ActivityTypes.Message) {
            context.turnState.set(skillClientKey, new MockSkillBotFrameworkClient());
            await next();
        }
    }
}



describe('ActionPolicyTests', function () {
    this.timeout(10000);

    ComponentRegistration.add(new AdaptiveComponentRegistration());
    ComponentRegistration.add(new AdaptiveTestComponentRegistration());

    const resourceExplorer = new ResourceExplorer().addFolder(
        path.join(__dirname, 'resources/ActionPolicyTests'),
        true,
        false
    );

    const validator = new ActionPolicyValidator(resourceExplorer);

    it('LastAction_BreakLoop', async () => {
        try {
            var testName = 'LastAction_BreakLoop_Invalid';
            var script = resourceExplorer.loadType(`${testName}.test.dialog`);
            validator.validatePolicies(script.dialog);
            
            // await TestUtils.runTestScript(resourceExplorer, 'LastAction_BreakLoop_Invalid');
        } catch (error) {
            assert(BreakLoop.Kind === error.ActionPolicy.Kind, `kind of error does not match expected kind.`);
            assert(ActionPolicyType.LastAction === error.ActionPolicyType, `policy type of error does not match.`);
        }
    });

    it('LastAction_CancelAllDialogs', async () => {
        // await TestUtils.runTestScript(resourceExplorer, 'LastAction_CancelAllDialogs_Invalid');
    });

    it('OnEndOfConversationActivity', async () => {
        // await TestUtils.runTestScript(resourceExplorer, 'OnEndOfConversationActivity_Valid');
    });

    it('TriggerNotInteractive_OnEndOfConversationActivity', async () => {
        // await TestUtils.runTestScript(resourceExplorer, 'TriggerNotInteractive_OnEndOfConversationActivity_Invalid.');
    });
/*

    it('BeginSkill', async () => {
        await TestUtils.runTestScript(
            resourceExplorer,
            'Action_BeginSkill',
            undefined,
            new SetSkillConversationIdFactoryBaseMiddleware(),
            new SetSkillBotFrameworkClientMiddleware()
        );
    });

    it('HttpRequest', async () => {
        nock('http://foo.com').post('/', 'Joe is 52').reply(200, 'string');
        nock('http://foo.com').post('/', { text: 'Joe is 52', age: 52 }).reply(200, 'object');
        nock('http://foo.com')
            .post('/', [
                { text: 'Joe is 52', age: 52 },
                { text: 'text', age: 11 },
            ])
            .reply(200, 'array');
        nock('http://foo.com').get('/image').reply(200, 'TestImage');
        nock('http://foo.com').get('/json').reply(200, { test: 'test' });
        nock('http://foo.com').get('/activity').reply(200, MessageFactory.text('testtest'));
        nock('http://foo.com')
            .get('/activities')
            .reply(200, [MessageFactory.text('test1'), MessageFactory.text('test2'), MessageFactory.text('test3')]);
        await TestUtils.runTestScript(resourceExplorer, 'Action_HttpRequest');
    });
    */
});
