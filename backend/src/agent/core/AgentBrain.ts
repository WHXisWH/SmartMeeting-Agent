import { PerceptionModule } from './PerceptionModule.js';
import { ReasoningEngine } from './ReasoningEngine.js';
import { PlanningModule } from './PlanningModule.js';
import { LearningSystem } from './LearningSystem.js';
import { MemorySystem } from './MemorySystem.js';
import { FirestoreService } from '../../services/FirestoreService.js';
import { AgentContext, AgentAction, Decision } from '../../types/index.js';
import { Logger } from '../../utils/Logger.js';

// Mock Action Executor for demo purposes
class ActionExecutor {
    private logger = new Logger("ActionExecutor");
    public async execute(action: AgentAction) {
        this.logger.info(`Executing action: ${action.action}`, action.params);
        await new Promise(resolve => setTimeout(resolve, 500));
        const success = Math.random() > 0.1;
        this.logger.info(`Action ${action.action} finished with status: ${success ? 'Success' : 'Failure'}`);
        return { 
            success,
            timeSaved: Math.floor(Math.random() * 60),
            satisfaction: 4.0 + Math.random()
        };
    }
}

export class AgentBrain {
    private perception: PerceptionModule | null = null;
    private reasoning: ReasoningEngine | null = null;
    private planning: PlanningModule | null = null;
    private learning: LearningSystem | null = null;
    private memory: MemorySystem | null = null;
    private executor: ActionExecutor | null = null;
    private firestoreService: FirestoreService | null = null;
    private logger: Logger;

    private isRunning: boolean = false;
    private isInitialized: boolean = false;
    private isInitializing: boolean = false;
    private initializationError: Error | null = null;

    constructor() {
        this.logger = new Logger('AgentBrain');
        this.logger.info('AgentBrain constructor completed - ready for async initialization');
    }

    // Asynchronous initialization method
    public async initialize(): Promise<void> {
        if (this.isInitialized) {
            this.logger.info('AgentBrain already initialized');
            return;
        }

        if (this.isInitializing) {
            this.logger.info('AgentBrain initialization already in progress');
            return;
        }

        this.isInitializing = true;
        this.logger.info('Starting AgentBrain async initialization...');

        try {
            // Create basic services - initialize in dependency order
            this.logger.info('Initializing Firestore service...');
            this.firestoreService = new FirestoreService();
            
            this.logger.info('Initializing Memory system...');
            this.memory = new MemorySystem();
            
            this.logger.info('Initializing core modules...');
            this.perception = new PerceptionModule();
            this.planning = new PlanningModule();
            this.learning = new LearningSystem();
            this.executor = new ActionExecutor();
            
            // Finally initialize the reasoning engine (depends on memory)
            this.logger.info('Initializing Reasoning engine...');
            this.reasoning = new ReasoningEngine(this.memory);

            // Record initialization completion
            await this.logActivity('AgentBrain fully initialized with all modules');
            
            this.isInitialized = true;
            this.isInitializing = false;
            this.logger.info('AgentBrain initialization completed successfully');

        } catch (error) {
            this.initializationError = error as Error;
            this.isInitializing = false;
            this.logger.error('AgentBrain initialization failed', error);
            throw error;
        }
    }

    // Get initialization status
    public getInitializationStatus(): { 
        initialized: boolean; 
        initializing: boolean; 
        error: string | null 
    } {
        return {
            initialized: this.isInitialized,
            initializing: this.isInitializing,
            error: this.initializationError?.message || null
        };
    }

    public async start(): Promise<void> {
        if (!this.isInitialized) {
            this.logger.warn('Cannot start agent - not initialized yet');
            return;
        }
        
        if (this.isRunning) return;
        this.isRunning = true;
        await this.logActivity('Agent autonomous loop started.');
        this.runCycle();
    }

    public async stop(): Promise<void> {
        this.isRunning = false;
        await this.logActivity('Agent autonomous loop stopped.');
    }

    private async runCycle(): Promise<void> {
        if (!this.isRunning || !this.isInitialized) return;

        // Check if all required modules are initialized
        if (!this.perception || !this.planning || !this.reasoning || !this.executor || !this.learning || !this.firestoreService) {
            this.logger.error('Cannot run cycle - some modules not initialized');
            return;
        }

        try {
            await this.logActivity('Starting new agent cycle.');

            const context: AgentContext = await this.perception.perceive();
            await this.logActivity('Perceived current environment state.', context);

            const plan = this.planning.createPlan('Maximize team meeting ROI', context);
            await this.logActivity('Created a new plan.', plan);

            const decision = await this.reasoning.reason({ 
                context: context,
                problem: plan.tactical.thisWeek.conflicts_to_resolve[0],
                goal: 'Maximize team meeting ROI'
            });
            await this.logActivity('Reasoning complete, decision made.', decision);
            await this.firestoreService.addDecision(decision as any);

            const action: AgentAction = { action: decision.decision.action, params: decision.decision.rationale, confidence: decision.confidence, explanation: decision.explanation };
            const outcome = await this.executor.execute(action);
            await this.logActivity('Action execution finished.', { action, outcome });

            this.learning.learn({ context, action, outcome });
            await this.logActivity('Learning process complete.');

        } catch (error) {
            if (error instanceof Error) {
                this.logger.error('Error in agent cycle', error);
                await this.logActivity('Error occurred in agent cycle.', { error: error.message });
            } else {
                this.logger.error('An unknown error occurred in agent cycle');
                await this.logActivity('An unknown error occurred in agent cycle.');
            }
        }

        setTimeout(() => this.runCycle(), 15000);
    }

    private async logActivity(message: string, data?: any): Promise<void> {
        this.logger.info(message, data);
        if (this.firestoreService) {
            try {
                await this.firestoreService.addActivityLog({ timestamp: new Date(), message, data });
            } catch (error) {
                this.logger.warn('Failed to log activity to Firestore', error);
            }
        }
    }

    // --- Public API for frontend ---

    public async getStatus() {
        const initStatus = this.getInitializationStatus();
        
        if (!this.isInitialized) {
            return {
                isRunning: false,
                lastActivity: initStatus.initializing ? 'Initializing agent...' : 
                            initStatus.error ? `Initialization failed: ${initStatus.error}` : 
                            'Agent not initialized',
                initialized: this.isInitialized,
                initializing: initStatus.initializing,
                error: initStatus.error
            };
        }

        try {
            const logs = this.firestoreService ? await this.firestoreService.getActivityLog(1) : [];
            return {
                isRunning: this.isRunning,
                lastActivity: logs.length > 0 ? logs[0].message : 'Agent ready',
                initialized: this.isInitialized,
                initializing: false,
                error: null
            };
        } catch (error) {
            return {
                isRunning: this.isRunning,
                lastActivity: 'Error retrieving status',
                initialized: this.isInitialized,
                initializing: false,
                error: (error as Error).message
            };
        }
    }

    public async getActivityLog() {
        if (!this.firestoreService) {
            return [{ 
                timestamp: new Date(), 
                message: 'Agent not fully initialized', 
                data: this.getInitializationStatus() 
            }];
        }
        
        try {
            return await this.firestoreService.getActivityLog(100);
        } catch (error) {
            return [{ 
                timestamp: new Date(), 
                message: 'Error retrieving activity log', 
                data: { error: (error as Error).message }
            }];
        }
    }

    public async getLatestDecision() {
        if (!this.firestoreService) {
            return {
                decision: { action: 'Initializing', rationale: 'Agent is starting up' },
                confidence: 0.1,
                timestamp: new Date(),
                status: 'initializing'
            };
        }
        
        try {
            return await this.firestoreService.getLatestDecision();
        } catch (error) {
            return {
                decision: { action: 'Error', rationale: 'Failed to retrieve decision' },
                confidence: 0.0,
                timestamp: new Date(),
                error: (error as Error).message
            };
        }
    }

    public getMetrics() {
        return {
            timeSaved: 3.5,
            meetingsOptimized: 5,
            conflictsResolved: 12,
            satisfaction: 4.8
        }
    }
}