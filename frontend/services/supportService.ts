import api, { getApiData } from './api';

export async function fetchFaq(): Promise<Array<{ id: string; question: string; answer: string }>> {
  const response = await api.get('/support/faq');
  return getApiData<Array<{ id: string; question: string; answer: string }>>(response) || [];
}

export async function submitSupportQuery(question: string): Promise<{ answer: string }> {
  const response = await api.post('/support/query', { question });
  return getApiData<{ answer: string }>(response);
}
