import type {ChannelAdapter} from '../types';
/** SMS uses the durable, explicitly reviewed send service. Generic bot,
 * flow, campaign and inbox send paths cannot bypass that authority. */
export const smsAdapter:ChannelAdapter={
 channel:'sms',label:'SMS',isConfigured:connection=>connection.config.native_sms===true&&connection.status==='connected',
 async sendText(){throw new Error('sms_review_required');},
 async parseWebhook(){return [];},
};
