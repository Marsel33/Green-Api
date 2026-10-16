
import type { Message } from '../types/message';

const API_URL = 'https://api.green-api.com';

type GreenApiCredentials = {
  idInstance: string;
  apiTokenInstance: string;
};

type SendMessageResponse = {
  idMessage: string;
};

type Notification = {
  receiptId: number;
  body: {
    typeWebhook: string;
    idMessage?: string;
    senderData?: {
      chatId?: string;
      sender?: string;
    };
    messageData?: {
      typeMessage: string;
      textMessageData?: {
        textMessage?: string;
      };
      extendedTextMessageData?: {
        text?: string;
      };
    };
  };
};

async function readResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();

  if (!response.ok) {
    throw new Error(`GREEN-API: HTTP ${response.status}`);
  }

  return data as T;
}

export async function checkConnection(
  credentials: GreenApiCredentials,
): Promise<unknown> {
  const { idInstance, apiTokenInstance } = credentials;

  const response = await fetch(
    `${API_URL}/waInstance${idInstance}/getStateInstance/${apiTokenInstance}`,
  );

  return readResponse(response);
}

export async function sendMessage(
  credentials: GreenApiCredentials,
  phone: string,
  text: string,
): Promise<SendMessageResponse> {
  const { idInstance, apiTokenInstance } = credentials;

  const response = await fetch(
    `${API_URL}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId: `${phone}@c.us`,
        message: text,
      }),
    },
  );

  return readResponse(response);
}

export async function receiveNotification(
  credentials: GreenApiCredentials,
): Promise<Notification | null> {
  const { idInstance, apiTokenInstance } = credentials;

  const response = await fetch(
    `${API_URL}/waInstance${idInstance}/receiveNotification/${apiTokenInstance}`,
  );

  if (!response.ok) {
    throw new Error(`GREEN-API: HTTP ${response.status}`);
  }

  return response.json();
}

export async function deleteNotification(
  credentials: GreenApiCredentials,
  receiptId: number,
): Promise<void> {
  const { idInstance, apiTokenInstance } = credentials;

  const response = await fetch(
    `${API_URL}/waInstance${idInstance}/deleteNotification/${apiTokenInstance}/${receiptId}`,
    { method: 'DELETE' },
  );

  if (!response.ok) {
    throw new Error(`GREEN-API: HTTP ${response.status}`);
  }
}

export function parseNotification(
  notification: Notification,
): Message | null {
  const { body } = notification;

  if (body.typeWebhook !== 'incomingMessageReceived') {
    return null;
  }

  const messageData = body.messageData;
  if (!messageData) {
    return null;
  }

  let text: string | undefined;

  if (messageData.typeMessage === 'textMessage') {
    text = messageData.textMessageData?.textMessage;
  } else if (messageData.typeMessage === 'extendedTextMessage') {
    text = messageData.extendedTextMessageData?.text;
  }

  if (!text || !body.idMessage) {
    return null;
  }

  return {
    id: body.idMessage,
    text,
    sender: 'other',
  };
}
