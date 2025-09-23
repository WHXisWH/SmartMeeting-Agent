import { google, Auth } from 'googleapis';
import { Firestore } from '@google-cloud/firestore';
import { PubSub } from '@google-cloud/pubsub';
import { Meeting, Task, Participant } from '../types/index.js';
import { Logger } from '../utils/Logger.js';

export class GoogleWorkspaceService {
  private auth: Auth.OAuth2Client;
  private calendar: any;
  private gmail: any;
  private drive: any;
  private docs: any;
  private slides: any;
  private firestore: Firestore;
  private pubsub: PubSub;
  private logger: Logger;
  private tokenLoaded: boolean = false;

  constructor() {
    this.logger = new Logger('GoogleWorkspaceService');
    this.auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this.calendar = google.calendar({ version: 'v3', auth: this.auth });
    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    this.docs = google.docs({ version: 'v1', auth: this.auth });
    this.slides = google.slides({ version: 'v1', auth: this.auth });
    this.firestore = new Firestore();
    this.pubsub = new PubSub();

    this.loadDefaultUserTokens().catch(err => {
      this.logger.warn('Failed to load default user OAuth tokens; some tools may be unavailable', err);
    });

    this.auth.on('tokens', async (tokens) => {
      try {
        const email = process.env.DEFAULT_USER_EMAIL || '';
        if (!email) return;
        await this.firestore.collection('oauth_tokens').doc(email).set({
          ...tokens,
          updatedAt: Date.now()
        }, { merge: true });
        this.logger.info('OAuth tokens refreshed and saved');
      } catch (e) {
        this.logger.warn('Failed to persist refreshed tokens', e);
      }
    });
  }

  static async forUser(email: string): Promise<GoogleWorkspaceService> {
    const svc = new GoogleWorkspaceService();
    await svc.useUser(email);
    return svc;
  }

  async useUser(email: string): Promise<void> {
    const doc = await this.firestore.collection('oauth_tokens').doc(email).get();
    if (!doc.exists) {
      throw new Error(`OAuth tokens not found for ${email}`);
    }
    const tokens = doc.data() as any;
    this.auth.setCredentials(tokens || {});
    this.tokenLoaded = true;
    // Ensure refresh writes back to this user's doc
    this.auth.removeAllListeners('tokens');
    this.auth.on('tokens', async (t) => {
      try {
        await this.firestore.collection('oauth_tokens').doc(email).set({ ...t, updatedAt: Date.now() }, { merge: true });
      } catch (e) {
        this.logger.warn('Failed to persist refreshed tokens for user', { email, error: (e as Error).message });
      }
    });
  }

  private async loadDefaultUserTokens(): Promise<void> {
    const email = process.env.DEFAULT_USER_EMAIL || '';
    if (!email) {
      this.logger.warn('DEFAULT_USER_EMAIL is not set; cannot load OAuth tokens');
      return;
    }
    const doc = await this.firestore.collection('oauth_tokens').doc(email).get();
    if (!doc.exists) {
      this.logger.warn('OAuth tokens not found in Firestore', { email });
      return;
    }
    const tokens = doc.data() as any;
    if (!tokens) {
      this.logger.warn('Empty token document', { email });
      return;
    }
    this.auth.setCredentials(tokens);
    this.logger.info('Default user OAuth tokens loaded', { email });
    this.tokenLoaded = true;
  }

  private async ensureAuth(): Promise<void> {
    const creds: any = this.auth.credentials || {};
    if (creds.access_token || creds.refresh_token || this.tokenLoaded) return;
    await this.loadDefaultUserTokens();
  }

  // FreeBusy API: get busy slots for multiple calendars
  async getFreeBusy(calendars: string[], timeMin: Date, timeMax: Date, timeZone?: string): Promise<Record<string, Array<{ start: string; end: string }>>> {
    await this.ensureAuth();
    const items = calendars.map(id => ({ id }));
    const body: any = { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items };
    if (timeZone) body.timeZone = timeZone;
    try {
      const resp = await this.calendar.freebusy.query({ requestBody: body });
      const fb: any = resp.data.calendars || {};
      const result: Record<string, Array<{ start: string; end: string }>> = {};
      for (const [id, obj] of Object.entries<any>(fb)) {
        result[id] = (obj.busy || []).map((b: any) => ({ start: b.start, end: b.end }));
      }
      return result;
    } catch (e) {
      this.logger.error('FreeBusy query failed', e);
      throw e;
    }
  }

  async getEvents(timeMin?: Date, timeMax?: Date): Promise<any[]> {
    try {
      await this.ensureAuth();
      const response = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin?.toISOString() || new Date().toISOString(),
        timeMax: timeMax?.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });

      return response.data.items || [];
    } catch (error) {
      this.logger.error('Failed to get calendar events', error);
      throw error;
    }
  }

  async createMeeting(meeting: Partial<Meeting>): Promise<string> {
    try {
      await this.ensureAuth();
      const event = {
        summary: meeting.title,
        description: meeting.description,
        start: {
          dateTime: meeting.startTime?.toISOString(),
          timeZone: 'Asia/Shanghai',
        },
        end: {
          dateTime: meeting.endTime?.toISOString(),
          timeZone: 'Asia/Shanghai',
        },
        attendees: meeting.participants?.map(p => ({
          email: p.email,
          displayName: p.name,
          responseStatus: p.responseStatus,
        })),
        conferenceData: {
          createRequest: {
            requestId: `meet_${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        }
      };

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        conferenceDataVersion: 1,
        sendUpdates: 'all',
      });

      this.logger.info('Meeting created', { eventId: response.data.id });
      return response.data.id!;
    } catch (error) {
      this.logger.error('Failed to create meeting', error);
      throw error;
    }
  }

  async updateMeeting(eventId: string, updates: Partial<Meeting>): Promise<void> {
    try {
      await this.ensureAuth();
      const updateData: any = {};
      
      if (updates.title) updateData.summary = updates.title;
      if (updates.description) updateData.description = updates.description;
      if (updates.startTime) updateData.start = { 
        dateTime: updates.startTime.toISOString(),
        timeZone: 'Asia/Shanghai'
      };
      if (updates.endTime) updateData.end = { 
        dateTime: updates.endTime.toISOString(),
        timeZone: 'Asia/Shanghai'
      };
      if (updates.participants) updateData.attendees = updates.participants.map(p => ({
        email: p.email,
        displayName: p.name,
        responseStatus: p.responseStatus,
      }));

      await this.calendar.events.patch({
        calendarId: 'primary',
        eventId: eventId,
        resource: updateData,
        sendUpdates: 'all',
      });

      this.logger.info('Meeting updated', { eventId });
    } catch (error) {
      this.logger.error('Failed to update meeting', error);
      throw error;
    }
  }

  async cancelMeeting(eventId: string, reason?: string): Promise<void> {
    try {
      await this.ensureAuth();
      const event = await this.calendar.events.get({
        calendarId: 'primary',
        eventId: eventId,
      });

      if (reason && event.data.attendees) {
        await this.sendCancellationEmail(
          event.data.attendees.map((a: any) => a.email),
          event.data.summary || 'Meeting',
          reason
        );
      }

      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId,
        sendUpdates: 'all',
      });

      this.logger.info('Meeting cancelled', { eventId });
    } catch (error) {
      this.logger.error('Failed to cancel meeting', error);
      throw error;
    }
  }

  async detectConflicts(startTime: Date, endTime: Date, participants: string[]): Promise<any[]> {
    try {
      await this.ensureAuth();
      const conflicts: any[] = [];

      for (const participantEmail of participants) {
        const events = await this.calendar.events.list({
          calendarId: participantEmail,
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          singleEvents: true,
        });

        if (events.data.items && events.data.items.length > 0) {
          conflicts.push({
            participant: participantEmail,
            conflicts: events.data.items,
          });
        }
      }

      return conflicts;
    } catch (error) {
      this.logger.error('Failed to detect conflicts', error);
      return [];
    }
  }

  async sendEmail(to: string[], subject: string, body: string, attachments?: any[]): Promise<void> {
    try {
      await this.ensureAuth();
      const message = this.createEmailMessage(to, subject, body, attachments);
      
      await this.gmail.users.messages.send({
        userId: 'me',
        resource: {
          raw: message,
        },
      });

      this.logger.info('Email sent', { to, subject });
    } catch (error) {
      this.logger.error('Failed to send email', error);
      throw error;
    }
  }

  async sendCancellationEmail(to: string[], meetingTitle: string, reason: string): Promise<void> {
    const subject = `Meeting cancelled: ${meetingTitle}`;
    const body = `
    <p>Hello,</p>
    <p>The meeting "${meetingTitle}" has been cancelled.</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p>Please contact the organizer if you have questions.</p>
    <p>Sent by SmartMeet AI Agent.</p>
    `;

    await this.sendEmail(to, subject, body);
  }

  private createEmailMessage(to: string[], subject: string, body: string, attachments?: any[]): string {
    const boundary = `boundary_${Date.now()}`;
    let message = [
      `To: ${to.join(', ')}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      body,
    ].join('\n');

    if (attachments && attachments.length > 0) {
      // 处理附件逻辑
      for (const attachment of attachments) {
        message += `\n--${boundary}\n`;
        message += `Content-Type: ${attachment.mimeType}\n`;
        message += `Content-Disposition: attachment; filename="${attachment.filename}"\n`;
        message += `Content-Transfer-Encoding: base64\n\n`;
        message += attachment.data;
      }
    }

    message += `\n--${boundary}--`;

    return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  }

  async createDocument(title: string, content: string): Promise<string> {
    try {
      const doc = await this.docs.documents.create({
        resource: {
          title: title,
        },
      });

      const docId = doc.data.documentId!;

      if (content) {
        await this.docs.documents.batchUpdate({
          documentId: docId,
          resource: {
            requests: [{
              insertText: {
                location: {
                  index: 1,
                },
                text: content,
              },
            }],
          },
        });
      }

      this.logger.info('Document created', { docId, title });
      return docId;
    } catch (error) {
      this.logger.error('Failed to create document', error);
      throw error;
    }
  }

  async createMeetingFolder(meetingTitle: string, meetingId: string): Promise<string> {
    try {
      const folderMetadata = {
        name: `${meetingTitle} - ${meetingId}`,
        mimeType: 'application/vnd.google-apps.folder',
      };

      const folder = await this.drive.files.create({
        resource: folderMetadata,
        fields: 'id',
      });

      this.logger.info('Meeting folder created', { folderId: folder.data.id });
      return folder.data.id!;
    } catch (error) {
      this.logger.error('Failed to create meeting folder', error);
      throw error;
    }
  }

  async setupCalendarWatch(): Promise<void> {
    try {
      const watchRequest = {
        id: `agent-watch-${Date.now()}`,
        type: 'web_hook',
        address: `${process.env.WEBHOOK_BASE_URL}/webhooks/calendar`,
        token: process.env.WEBHOOK_TOKEN,
      };

      await this.calendar.events.watch({
        calendarId: 'primary',
        resource: watchRequest,
      });

      this.logger.info('Calendar webhook configured');
    } catch (error) {
      this.logger.error('Failed to configure Calendar webhook', error);
      throw error;
    }
  }

  async setupGmailWatch(): Promise<void> {
    try {
      const watchRequest = {
        topicName: `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/agent-gmail`,
        labelIds: ['INBOX'],
      };

      await this.gmail.users.watch({
        userId: 'me',
        resource: watchRequest,
      });

      this.logger.info('Gmail watch configured');
    } catch (error) {
      this.logger.error('Failed to configure Gmail watch', error);
      throw error;
    }
  }

  async batchUpdateEvents(updates: Array<{ eventId: string; updates: any }>): Promise<void> {
    try {
      const promises = updates.map(({ eventId, updates: updateData }) =>
        this.calendar.events.patch({
          calendarId: 'primary',
          eventId: eventId,
          resource: updateData,
          sendUpdates: 'all',
        })
      );

      await Promise.all(promises);
      this.logger.info('Batch update events completed', { count: updates.length });
    } catch (error) {
      this.logger.error('Failed to batch update events', error);
      throw error;
    }
  }

  async analyzeMeetingPatterns(startDate: Date, endDate: Date): Promise<any> {
    try {
      const events = await this.getEvents(startDate, endDate);
      
      const analysis: { [key: string]: any } = {
        totalMeetings: events.length,
        averageDuration: 0,
        meetingsByDay: {},
        participantFrequency: {},
        recurringMeetings: 0,
      };

      let totalDuration = 0;
      
      for (const event of events) {
        if (event.start?.dateTime && event.end?.dateTime) {
          const start = new Date(event.start.dateTime);
          const end = new Date(event.end.dateTime);
          const duration = (end.getTime() - start.getTime()) / (1000 * 60);
          
          totalDuration += duration;
          
          const day = start.toDateString();
          analysis.meetingsByDay[day] = (analysis.meetingsByDay[day] || 0) + 1;
          
          if (event.attendees) {
            for (const attendee of event.attendees) {
              analysis.participantFrequency[attendee.email] = 
                (analysis.participantFrequency[attendee.email] || 0) + 1;
            }
          }
          
          if (event.recurrence) {
            analysis.recurringMeetings++;
          }
        }
      }

      analysis.averageDuration = events.length > 0 ? totalDuration / events.length : 0;

      return analysis;
    } catch (error) {
      this.logger.error('Failed to analyze meeting patterns', error);
      throw error;
    }
  }

  async createUserCalendarWatch(email: string): Promise<{ channelId: string; address: string; token: string; calendarId: string; createdAt: number }> {
    await this.useUser(email);
    const channelId = `agent-cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const address = `${process.env.WEBHOOK_BASE_URL}/webhooks/calendar`;
    const token = process.env.WEBHOOK_TOKEN || '';
    await this.calendar.events.watch({
      calendarId: 'primary',
      requestBody: { id: channelId, type: 'webhook', address, token }
    } as any);
    await this.firestore
      .collection('tenants').doc(email)
      .collection('watch_calendar').doc(channelId)
      .set({ id: channelId, email, address, token, calendarId: 'primary', createdAt: Date.now() }, { merge: true });
    return { channelId, address, token, calendarId: 'primary', createdAt: Date.now() };
  }

  async createUserGmailWatch(email: string): Promise<{ historyId?: string; expiration?: string | number; topicName: string }> {
    await this.useUser(email);
    const topicName = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/agent-gmail`;
    const resp = await this.gmail.users.watch({ userId: 'me', requestBody: { topicName, labelIds: ['INBOX'] } as any } as any);
    const data: any = resp.data || {};
    await this.firestore
      .collection('tenants').doc(email)
      .collection('watch_gmail').doc('me')
      .set({ topicName, historyId: data.historyId, expiration: data.expiration, updatedAt: Date.now() }, { merge: true });
    return { historyId: data.historyId, expiration: data.expiration, topicName };
  }
}
