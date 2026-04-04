/**
 * Anvil V2 Ingestion Pipeline — stage and orchestrator exports.
 *
 * @module core/pipeline
 */

export { validateEntity } from './stages/validate.js';
export type { ValidateEntityInput } from './stages/validate.js';

export { IndexStage } from './stages/index-stage.js';

export { RollbackTracker, createPipelineError } from './rollback.js';
export type { StageName, RollbackAction, PipelineError } from './rollback.js';

export { IngestPipeline } from './ingest-pipeline.js';
export type { CreateEntityInput, CreateEntityResult } from './ingest-pipeline.js';
