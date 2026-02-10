/**
 * Notifications Service Module
 *
 * Exports all notification-related services and providers.
 */

export { NotificationProvider } from './NotificationProvider.js';
export { notificationService, NotificationService } from './NotificationService.js';
export { ruleEngine, RuleEngine } from './RuleEngine.js';
export { NtfyProvider } from './providers/NtfyProvider.js';

// Default export: the main services
export default {
    notificationService: (await import('./NotificationService.js')).default,
    ruleEngine: (await import('./RuleEngine.js')).default
};

