import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MessageSquare, Send } from 'lucide-react';
import clsx from 'clsx';
import { api, errorMessage, isPlanLimitError } from '../lib/api';
import { Card, PageHeader, Spinner } from '../components/ui';

interface AssistantStatus {
  enabled: boolean;
  suggestions: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
}

export function Assistant() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({
    queryKey: ['assistant-status'],
    queryFn: async () => (await api.get<AssistantStatus>('/assistant/status')).data,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const ask = useMutation({
    mutationFn: async (message: string) =>
      (
        await api.post<{ conversationId: string; message: Message; toolsUsed: string[] }>(
          '/assistant/ask',
          { message, conversationId: conversationId ?? undefined },
        )
      ).data,
    onSuccess: (response) => {
      setConversationId(response.conversationId);
      setMessages((current) => [
        ...current,
        { ...response.message, toolsUsed: response.toolsUsed },
      ]);
      void queryClient.invalidateQueries({ queryKey: ['entitlements'] });
    },
    onError: (err) => {
      setError(errorMessage(err, 'The assistant could not answer.'));
      // Drop the optimistic user turn — leaving it would imply it was received.
      setMessages((current) => current.slice(0, -1));
    },
  });

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || ask.isPending) return;

    setError('');
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: 'user', content: trimmed },
    ]);
    setDraft('');
    ask.mutate(trimmed);
  }

  if (status && !status.enabled) {
    return (
      <div>
        <PageHeader title="Assistant" />
        <Card>
          <div className="py-10 text-center">
            <MessageSquare className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 font-semibold text-slate-900">The assistant is not switched on</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Whoever runs this BizPilot installation needs to add an Anthropic API key. Everything
              else in BizPilot works without it.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-13rem)] flex-col lg:h-[calc(100vh-8rem)]">
      <PageHeader
        title="Ask your business"
        subtitle="Questions about your own sales, stock and customers — answered from your records."
      />

      <Card padded={false} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="py-6 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-brand-400" />
              <p className="mt-3 text-sm text-slate-600">
                Ask anything about your shop. Try one of these:
              </p>
              <div className="mx-auto mt-4 flex max-w-lg flex-wrap justify-center gap-2">
                {status?.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-brand-400 hover:bg-brand-50"
                    onClick={() => submit(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={clsx('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={clsx(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  message.role === 'user'
                    ? 'bg-brand-700 text-white'
                    : 'bg-slate-100 text-slate-900',
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.toolsUsed && message.toolsUsed.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    Checked: {message.toolsUsed.map(humanTool).join(', ')}
                  </p>
                )}
              </div>
            </div>
          ))}

          {ask.isPending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3">
                <Spinner className="h-4 w-4" />
                <span className="text-sm text-slate-500">Reading your records…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
              {isPlanLimitError(ask.error) && (
                <>
                  {' '}
                  <Link to="/app/billing" className="font-semibold underline">
                    Upgrade for more questions
                  </Link>
                </>
              )}
            </div>
          )}

          <div ref={endRef} />
        </div>

        <form
          className="flex gap-2 border-t border-slate-200 p-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <input
            className="input"
            placeholder="How much profit did I make this month?"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={ask.isPending}
            aria-label="Your question"
          />
          <button
            type="submit"
            className="btn-primary shrink-0 px-4"
            disabled={ask.isPending || !draft.trim()}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </Card>
    </div>
  );
}

/** Tool names are internal; show the shopkeeper what was actually looked at. */
function humanTool(name: string): string {
  const labels: Record<string, string> = {
    get_financial_summary: 'your sales and expenses',
    get_top_products: 'best sellers',
    get_low_stock: 'stock levels',
    get_dead_stock: 'slow-moving stock',
    get_expense_breakdown: 'your spending',
    get_receivables: 'who owes you',
    get_inventory_value: 'stock value',
    search_products: 'your products',
    get_busiest_hours: 'busiest hours',
  };
  return labels[name] ?? name.replace(/_/g, ' ');
}
