import { Logger } from "../../utils/Logger";
import { AgentAction, AgentContext, Decision } from "../../types";

interface Experience {
  context: AgentContext;
  action: AgentAction;
  outcome: any; // In a real system, this would be a structured outcome type
}

/**
 * @class LearningSystem
 * @description Simulates the agent's ability to learn from experience.
 * For the demo, this class logs experiences and simulated rewards rather than implementing a full reinforcement learning loop.
 */
export class LearningSystem {
  private logger: Logger;
  private experienceBuffer: Experience[] = [];

  constructor() {
    this.logger = new Logger("LearningSystem");
    this.logger.info("LearningSystem initialized.");
  }

  /**
   * The main method for the learning process.
   * @param experience - The experience to learn from.
   */
  public learn(experience: Experience) {
    this.logger.info("Learning from new experience...", experience);
    this.experienceBuffer.push(experience);

    const reward = this.calculateReward(experience);
    this.logger.info(`Calculated reward for the last action: ${reward}`);

    if (this.experienceBuffer.length % 5 === 0) {
      this.updatePolicy();
    }
  }

  /**
   * Simulates the calculation of a reward based on the outcome of an action.
   * @param experience - The experience containing the outcome.
   * @returns A numeric reward value.
   */
  private calculateReward(experience: Experience): number {
    // Simplified reward logic for demonstration
    let reward = 0;
    if (experience.outcome?.success) {
      reward += 10;
    }
    if (experience.outcome?.timeSaved > 0) {
      reward += experience.outcome.timeSaved * 0.5;
    }
    if (experience.outcome?.satisfaction > 4) {
      reward += 20;
    }
    if (experience.outcome?.error) {
      reward -= 50;
    }
    return reward;
  }

  /**
   * Simulates updating the agent's policy based on accumulated experience.
   */
  private updatePolicy() {
    if (this.experienceBuffer.length < 5) return;

    this.logger.info("Updating agent policy based on recent experiences...");
    // In a real implementation, this would involve training a model (e.g., Policy Gradient, Q-learning).
    // Here, we just log the intention.
    const recentExperiences = this.experienceBuffer.slice(-5);
    const averageReward = recentExperiences.reduce((acc, exp) => acc + this.calculateReward(exp), 0) / recentExperiences.length;

    this.logger.info(`Average reward over last 5 experiences: ${averageReward.toFixed(2)}`);
    this.logger.info("Policy model updated (simulation). New strategies will be considered.");
  }
}
