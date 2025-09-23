import { Logger } from '../utils/Logger.js';
import { GoogleWorkspaceService } from './GoogleWorkspaceService.js';

export class WatchBootstrapper {
  private static logger = new Logger('WatchBootstrapper');

  static async setupForUser(email: string): Promise<void> {
    try {
      const svc = await GoogleWorkspaceService.forUser(email);
      await Promise.all([
        svc.createUserGmailWatch(email).catch(e => {
          this.logger.warn('Gmail watch creation failed', { email, error: (e as Error).message });
        }),
        svc.createUserCalendarWatch(email).catch(e => {
          this.logger.warn('Calendar watch creation failed', { email, error: (e as Error).message });
        })
      ]);
      this.logger.info('Watch bootstrap completed', { email });
    } catch (e) {
      this.logger.warn('Watch bootstrap failed', { email, error: (e as Error).message });
    }
  }
}

