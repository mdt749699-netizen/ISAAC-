
export interface Message {
  role: 'user' | 'model' | 'error';
  content: string;
  image?: string;
}
