export type NotificationEvent = 'route_dispatched' | 'stop_approaching' | 'stop_arrived' | 'stop_completed' | 'stop_failed' | 'eta_updated';
export type NotificationChannel = 'sms' | 'email' | 'push';
export interface NotificationPayload {
    stopId: string;
    event: NotificationEvent;
    recipientPhone: string;
    recipientName: string;
    pharmacyName: string;
    pharmacyPhone: string;
    driverName: string;
    trackingUrl: string;
    etaMinutes?: number;
}
