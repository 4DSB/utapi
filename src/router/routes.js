import { BucketsHandler, AccountsHandler, ServiceHandler } from
    '../handlers/metricsHandlers';
import { validateBucketsListMetrics, validateAccountsListMetrics,
    validateServiceListMetrics } from '../validators/listMetrics';
import listMetricsResponse from '../responses/listMetrics';

export default [
    {
        validator: validateBucketsListMetrics,
        handler: BucketsHandler.listMetrics,
        method: 'POST',
        action: 'ListMetrics',
        resource: 'buckets',
        responseBuilder: listMetricsResponse,
        statusCode: 200,
    },
    {
        validator: validateAccountsListMetrics,
        handler: AccountsHandler.listMetrics,
        method: 'POST',
        action: 'ListMetrics',
        resource: 'accounts',
        responseBuilder: listMetricsResponse,
        statusCode: 200,
    },
    {
        validator: validateServiceListMetrics,
        handler: ServiceHandler.listMetrics,
        method: 'POST',
        action: 'ListMetrics',
        resource: 'service',
        responseBuilder: listMetricsResponse,
        statusCode: 200,
    },
];
