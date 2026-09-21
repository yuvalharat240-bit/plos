import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MODEL_PROVIDER } from './model-provider/model-provider.interface';
import { AnthropicModelProviderService } from './model-provider/anthropic-model-provider.service';
import { ConfirmationTokenService } from './tools/confirmation-token.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { SpecialistDispatcherService } from './specialists/specialist-dispatcher.service';
import { DisagreementService } from './disagreement.service';
import { AgentOutputRepository } from './agent-output.repository';
import { LifeMasterAgentService } from './life-master-agent.service';
import { AgentActionsService } from './agent-actions.service';
import { AgentController } from './agent.controller';

/**
 * docs/09 Milestone 5. `MODEL_PROVIDER` defaults to the real Anthropic-
 * backed implementation — tests override it with FakeModelProviderService
 * via Nest's `overrideProvider`, the same pattern every other e2e suite in
 * this codebase already uses for its own seams (APPLE_JWKS_RESOLVER, etc).
 */
@Module({
  // `ThrottlerModule` is registered exactly once, in AppModule — it's a
  // `@Global()` dynamic module (docs/09 Milestone 7 FINDING: registering
  // it a second time here, alongside AppModule's own, silently broke the
  // whole throttling mechanism app-wide — a real bug found by this
  // module's own e2e test starting to fail with a 500 instead of the
  // expected 429 the moment Milestone 7 added a second registration in
  // AuthModule. `AgentAskThrottlerGuard` below still resolves its
  // `ThrottlerModuleOptions`/`ThrottlerStorage` dependencies fine via the
  // global providers AppModule's single registration exports).
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [AgentController],
  providers: [
    { provide: MODEL_PROVIDER, useClass: AnthropicModelProviderService },
    ConfirmationTokenService,
    ToolRegistryService,
    ToolExecutorService,
    SpecialistDispatcherService,
    DisagreementService,
    AgentOutputRepository,
    LifeMasterAgentService,
    AgentActionsService,
  ],
})
export class AgentModule {}
