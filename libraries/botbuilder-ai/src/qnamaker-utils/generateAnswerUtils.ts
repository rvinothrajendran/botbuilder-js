/**
 * @module botbuilder-ai
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { TurnContext } from 'botbuilder-core';

import { QnAMakerResult } from '../qnamaker-interfaces/qnamakerResult';
import { QnAMakerResults } from '../qnamaker-interfaces/qnamakerResults';
import { QnAMakerEndpoint } from '../qnamaker-interfaces/qnamakerEndpoint';
import { QnAMakerOptions } from '../qnamaker-interfaces/qnamakerOptions';
import { QnAMakerTraceInfo } from '../qnamaker-interfaces/qnamakerTraceInfo';
import { HttpRequestUtils } from './httpRequestUtils';

import { QNAMAKER_TRACE_TYPE, QNAMAKER_TRACE_LABEL, QNAMAKER_TRACE_NAME } from '..';
import { RankerTypes } from '../qnamaker-interfaces/rankerTypes';

/**
 * Generate Answer api utils class.
 *
 * @summary
 * This class is helper class for generate answer api, which is used to make queries to a single QnA Maker knowledge base and return the result.
 */
export class GenerateAnswerUtils {
    httpRequestUtils: HttpRequestUtils;

    /**
     * Creates new Generate answer utils.
     *
     * @param {QnAMakerOptions} _options Settings used to configure the instance.
     * @param {QnAMakerEndpoint} endpoint The endpoint of the knowledge base to query.
     */
    constructor(public _options: QnAMakerOptions, private readonly endpoint: QnAMakerEndpoint) {
        this.httpRequestUtils = new HttpRequestUtils();

        this.validateOptions(this._options);
    }

    /**
     * Called internally to query the QnA Maker service.
     *
     * @param {QnAMakerEndpoint} endpoint The endpoint of the knowledge base to query.
     * @param {string} question Question which need to be queried.
     * @param {QnAMakerOptions} options (Optional) The options for the QnA Maker knowledge base. If null, constructor option is used for this instance.
     * @returns {Promise<QnAMakerResult[]>} a promise that resolves to the query results
     */
    public async queryQnaService(
        endpoint: QnAMakerEndpoint,
        question: string,
        options?: QnAMakerOptions
    ): Promise<QnAMakerResult[]> {
        const result = await this.queryQnaServiceRaw(endpoint, question, options);

        return result.answers;
    }

    /**
     * Called internally to query the QnA Maker service.
     *
     * @param {QnAMakerEndpoint} endpoint The endpoint of the knowledge base to query.
     * @param {string} question Question which need to be queried.
     * @param {QnAMakerOptions} options (Optional) The options for the QnA Maker knowledge base. If null, constructor option is used for this instance.
     * @returns {Promise<QnAMakerResult[]>} a promise that resolves to the raw query results
     */
    public async queryQnaServiceRaw(
        endpoint: QnAMakerEndpoint,
        question: string,
        options?: QnAMakerOptions
    ): Promise<QnAMakerResults> {
        const url = `${endpoint.host}/knowledgebases/${endpoint.knowledgeBaseId}/generateanswer`;
        const queryOptions: QnAMakerOptions = { ...this._options, ...options } as QnAMakerOptions;

        queryOptions.rankerType = !queryOptions.rankerType ? RankerTypes.default : queryOptions.rankerType;
        this.validateOptions(queryOptions);

        const payloadBody = JSON.stringify({
            question: question,
            strictFiltersCompoundOperationType: queryOptions.strictFiltersJoinOperator,
            ...queryOptions,
        });

        const qnaResults = await this.httpRequestUtils.executeHttpRequest(
            url,
            payloadBody,
            this.endpoint,
            queryOptions.timeout
        );

        if (Array.isArray(qnaResults?.answers)) {
            return this.formatQnaResult(qnaResults);
        }

        throw new Error(`Failed to generate answers: ${qnaResults}`);
    }

    /**
     * Emits a trace event detailing a QnA Maker call and its results.
     *
     * @param {TurnContext} turnContext Turn Context for the current turn of conversation with the user.
     * @param {QnAMakerResult[]} answers Answers returned by QnA Maker.
     * @param {QnAMakerOptions} queryOptions (Optional) The options for the QnA Maker knowledge base. If null, constructor option is used for this instance.
     * @returns {Promise<any>} a promise representing the async operation
     */
    public async emitTraceInfo(
        turnContext: TurnContext,
        answers: QnAMakerResult[],
        queryOptions?: QnAMakerOptions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Promise<any> {
        const requestOptions: QnAMakerOptions = { ...this._options, ...queryOptions };
        const { scoreThreshold, top, strictFilters, metadataBoost, context, qnaId } = requestOptions;

        const traceInfo: QnAMakerTraceInfo = {
            message: turnContext.activity,
            queryResults: answers,
            knowledgeBaseId: this.endpoint.knowledgeBaseId,
            scoreThreshold,
            top,
            strictFilters,
            metadataBoost,
            context,
            qnaId,
        };

        return turnContext.sendActivity({
            type: 'trace',
            valueType: QNAMAKER_TRACE_TYPE,
            name: QNAMAKER_TRACE_NAME,
            label: QNAMAKER_TRACE_LABEL,
            value: traceInfo,
        });
    }

    /**
     * Validate qna maker options
     *
     * @param {QnAMakerOptions} options The options for the QnA Maker knowledge base. If null, constructor option is used for this instance.
     */
    public validateOptions(options: QnAMakerOptions): void {
        const { scoreThreshold, top } = options;

        if (scoreThreshold) {
            this.validateScoreThreshold(scoreThreshold);
        }

        if (top) {
            this.validateTop(top);
        }
    }

    /**
     * Sorts all QnAMakerResult from highest-to-lowest scoring.
     * Filters QnAMakerResults within threshold specified (default threshold: .001).
     *
     * @param {QnAMakerResult[]} answers Answers returned by QnA Maker.
     * @param {QnAMakerOptions} queryOptions (Optional) The options for the QnA Maker knowledge base. If null, constructor option is used for this instance.
     * @returns {QnAMakerResult[]} the sorted and filtered results
     */
    public static sortAnswersWithinThreshold(
        answers: QnAMakerResult[] = [] as QnAMakerResult[],
        queryOptions: QnAMakerOptions
    ): QnAMakerResult[] {
        const minScore: number = typeof queryOptions.scoreThreshold === 'number' ? queryOptions.scoreThreshold : 0.001;

        return answers
            .filter((ans: QnAMakerResult) => ans.score >= minScore)
            .sort((a: QnAMakerResult, b: QnAMakerResult) => b.score - a.score);
    }

    private formatQnaResult(qnaResult: QnAMakerResults): QnAMakerResults {
        qnaResult.answers = qnaResult.answers.map((answer: QnAMakerResult & { qnaId?: number }) => {
            answer.score = answer.score / 100;

            if (answer.qnaId) {
                answer.id = answer.qnaId;
                delete answer.qnaId;
            }

            return answer;
        });

        qnaResult.activeLearningEnabled ??= true;

        return qnaResult;
    }

    private validateScoreThreshold(scoreThreshold: number): void {
        if (typeof scoreThreshold !== 'number' || !(scoreThreshold > 0 && scoreThreshold <= 1)) {
            throw new TypeError(
                `"${scoreThreshold}" is an invalid scoreThreshold. QnAMakerOptions.scoreThreshold must have a value between 0 and 1.`
            );
        }
    }

    private validateTop(qnaOptionTop: number): void {
        if (!Number.isInteger(qnaOptionTop) || qnaOptionTop < 1) {
            throw new RangeError(
                `"${qnaOptionTop}" is an invalid top value. QnAMakerOptions.top must be an integer greater than 0.`
            );
        }
    }
}
