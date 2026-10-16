export type Message = {
  id: string;
  text: string;
  sender: 'me' | 'other';
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
};