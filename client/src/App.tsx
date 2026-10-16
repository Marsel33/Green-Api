import { useState, useRef, useEffect } from 'react';
import type { FormEvent } from 'react';
import type { Message } from './types/message';
import {
  checkConnection,
  sendMessage,
  receiveNotification,
  deleteNotification,
  parseNotification,
} from './utils/api';

type Chat = {
  chatId: string;
  phone: string;
  messages: Message[];
};

function normalizePhone(value: string): string {
  let phone = value.trim().replace(/[\s()+-]/g, '');

  if (phone.startsWith('8') && phone.length === 11) {
    phone = `7${phone.slice(1)}`;
  }

  return phone;
}

function getChatTitle(chat: Chat): string {
  if (chat.chatId.endsWith('@g.us')) {
    return `Группа: ${chat.chatId.replace(/@g\.us$/, '')}`;
  }

  return chat.phone;
}

function App() {
  const [idInstance, setIdInstance] = useState('');
  const [apiTokenInstance, setApiTokenInstance] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  const [phone, setPhone] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isSending, setIsSending] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const activeChat = chats.find((chat) => chat.chatId === activeChatId);
  const isGroupChat = activeChat?.chatId.endsWith('@g.us') ?? false;

  useEffect(() => {
    const container = messagesContainerRef.current;

    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeChat?.messages]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const credentials = { idInstance, apiTokenInstance };
    let cancelled = false;
    let timeoutId: number | undefined;

    async function pollNotifications() {
      if (cancelled) {
        return;
      }

      try {
        const notification = await receiveNotification(credentials);

        if (cancelled) {
          return;
        }

        if (notification) {
          const incomingMessage = parseNotification(notification);
          const senderData = notification.body.senderData;
          const chatId = senderData?.chatId ?? '';

          if (
            incomingMessage &&
            (chatId.endsWith('@c.us') || chatId.endsWith('@g.us'))
          ) {
            const isGroup = chatId.endsWith('@g.us');
            const incomingPhone = isGroup
              ? ''
              : normalizePhone(chatId.replace(/@c\.us$/, ''));

            const messageWithSender: Message = {
              ...incomingMessage,
              sender: 'other',
            };

            setChats((previousChats) => {
              const existingChat = previousChats.find(
                (chat) => chat.chatId === chatId,
              );

              if (existingChat) {
                const alreadyExists = existingChat.messages.some(
                  (item) => item.id === messageWithSender.id,
                );

                if (alreadyExists) {
                  return previousChats;
                }

                return previousChats.map((chat) =>
                  chat.chatId === chatId
                    ? {
                        ...chat,
                        messages: [...chat.messages, messageWithSender],
                      }
                    : chat,
                );
              }

              return [
                ...previousChats,
                {
                  chatId,
                  phone: incomingPhone,
                  messages: [messageWithSender],
                },
              ];
            });
          }

          await deleteNotification(
            credentials,
            notification.receiptId,
          );
        }

        if (!cancelled) {
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Не удалось получить сообщение',
          );
        }
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(pollNotifications, 1000);
      }
    }

    void pollNotifications();

    return () => {
      cancelled = true;

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isConnected, idInstance, apiTokenInstance]);

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setStatus('');

    if (!idInstance.trim() || !apiTokenInstance.trim()) {
      setError('Введите idInstance и apiTokenInstance');
      return;
    }

    try {
      const result = (await checkConnection({
        idInstance: idInstance.trim(),
        apiTokenInstance: apiTokenInstance.trim(),
      })) as { stateInstance?: string };

      if (result.stateInstance !== 'authorized') {
        setIsConnected(false);
        setError(
          `WhatsApp не подключён. Статус: ${result.stateInstance ?? 'неизвестен'}`,
        );
        return;
      }

      setIsConnected(true);
      setStatus('Подключение успешно');
    } catch (err) {
      setIsConnected(false);
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось подключиться к GREEN-API',
      );
    }
  };

  const createChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setStatus('');

    const normalizedPhone = normalizePhone(phone);

    if (!/^\d{10,15}$/.test(normalizedPhone)) {
      setError('Введите номер из 10–15 цифр');
      return;
    }

    const chatId = `${normalizedPhone}@c.us`;
    const existingChat = chats.find((chat) => chat.chatId === chatId);

    if (!existingChat) {
      setChats((previousChats) => [
        ...previousChats,
        {
          chatId,
          phone: normalizedPhone,
          messages: [],
        },
      ]);
    }

    setActiveChatId(chatId);
    setPhone('');
  };

  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setStatus('');

    if (!isConnected) {
      setError('Сначала подключитесь к GREEN-API');
      return;
    }

    if (!activeChat) {
      setError('Сначала создайте или выберите чат');
      return;
    }

    if (isGroupChat) {
      setError(
        'Отправка сообщений в группы пока не поддерживается. Можно просматривать входящие сообщения.',
      );
      return;
    }

    if (!message.trim()) {
      setError('Введите сообщение');
      return;
    }

    const text = message.trim();
    const targetPhone = activeChat.phone;
    const targetChatId = activeChat.chatId;

    setIsSending(true);

    try {
      const result = await sendMessage(
        { idInstance, apiTokenInstance },
        targetPhone,
        text,
      );

      const sentMessage: Message = {
        id: result.idMessage,
        text,
        sender: 'me',
      };

      setChats((previousChats) =>
        previousChats.map((chat) => {
          if (chat.chatId !== targetChatId) {
            return chat;
          }

          if (chat.messages.some((item) => item.id === sentMessage.id)) {
            return chat;
          }

          return {
            ...chat,
            messages: [...chat.messages, sentMessage],
          };
        }),
      );

      setMessage('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось отправить сообщение',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="flex h-screen bg-[#eae6df] p-4">
      <div className="mx-auto flex w-full max-w-7xl overflow-hidden rounded-lg bg-white shadow-lg">
        <aside className="flex w-80 shrink-0 flex-col border-r border-gray-200">
          <header className="flex h-16 items-center bg-[#f0f2f5] px-5">
            <h1 className="text-xl font-semibold text-gray-800">
              WhatsApp
            </h1>
          </header>

          <form
            onSubmit={connect}
            className="flex flex-col gap-2 border-b border-gray-200 p-3"
          >
            <input
              value={idInstance}
              onChange={(event) => setIdInstance(event.target.value)}
              placeholder="idInstance"
              className="min-w-0 rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
            />

            <input
              value={apiTokenInstance}
              onChange={(event) => setApiTokenInstance(event.target.value)}
              placeholder="apiTokenInstance"
              type="password"
              className="min-w-0 rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
            />

            <button
              type="submit"
              className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 cursor-pointer"
            >
              {isConnected ? 'Переподключить' : 'Подключить GREEN-API'}
            </button>

            {isConnected && (
              <p className="text-xs text-green-700">Подключено</p>
            )}
          </form>

          <form
            onSubmit={createChat}
            className="flex gap-2 border-b border-gray-200 p-3"
          >
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Номер телефона"
              className="min-w-0 flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
            />

            <button
              type="submit"
              aria-label="Создать чат"
              className="rounded-lg bg-green-600 px-3 text-sm text-white hover:bg-green-700 cursor-pointer"
            >
              +
            </button>
          </form>

          <div className="flex-1 overflow-y-auto">
            {chats.length === 0 ? (
              <p className="p-4 text-center text-sm text-gray-500">
                Здесь будут ваши чаты
              </p>
            ) : (
              chats.map((chat) => (
                <button
                  type="button"
                  key={chat.chatId}
                  onClick={() => {
                    setActiveChatId(chat.chatId);
                    setError('');
                    setStatus('');
                  }}
                  className={`flex w-full flex-col border-b border-gray-100 p-4 text-left hover:bg-gray-50 cursor-pointer${
                    activeChatId === chat.chatId ? 'bg-[#f0f2f5]' : ''
                  }`}
                >
                  <span className="font-medium text-gray-800">
                    {getChatTitle(chat)}
                  </span>

                  <span className="mt-1 truncate text-sm text-gray-500">
                    {chat.messages.at(-1)?.text ?? 'Нет сообщений'}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center border-b border-gray-200 bg-[#f0f2f5] px-5 box-border">            
            <div className="flex flex-col">
              <h2 className="font-medium text-gray-500">
                {activeChat ? getChatTitle(activeChat) : 'Выберите чат'}
              </h2>
              <p className="text-xs text-gray-500">WhatsApp Web</p>
            </div>
          </header>

          <div
            ref={messagesContainerRef}
            className={`flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#efeae2] p-6 ${
              activeChat?.messages.length ? 'gap-2' : 'justify-center'
            }`}
          >
            {!activeChat ? (
              <p className="text-center text-gray-500">
                Выберите чат или создайте новый
              </p>
            ) : activeChat.messages.length === 0 ? (
              <p className="text-center text-gray-500">
                Нет сообщений. Напишите первым!
              </p>
            ) : (
              activeChat.messages.map((item) => {
                const isMine = item.sender === 'me';

                return (
                  <div
                    key={item.id}
                    className={`max-w-[75%] break-words rounded-lg px-3 py-2 text-gray-700 ${
                      isMine
                        ? 'self-end bg-[#d9fdd3] text-right'
                        : 'self-start bg-white text-left'
                    }`}
                  >
                    {item.text && <p>{item.text}</p>}
                  </div>
                );
              })
            )}
          </div>

          {(error || status) && (
            <p
              className={`px-3 py-1 text-sm ${
                error ? 'text-red-600' : 'text-green-700'
              }`}
            >
              {error || status}
            </p>
          )}

          <form
            onSubmit={submitMessage}
            className="flex items-center gap-3 bg-[#f0f2f5] p-3"
          >
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={
                !activeChat
                  ? 'Сначала выберите чат'
                  : isGroupChat
                    ? 'Просмотр сообщений группы'
                    : 'Введите сообщение'
              }
              disabled={!activeChat || isSending || isGroupChat}
              className="min-w-0 flex-1 rounded-lg bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={!activeChat || isSending || isGroupChat}
              className="cursor-pointer rounded-lg bg-green-600 px-5 py-3 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSending ? 'Отправка...' : 'Отправить'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

export default App;