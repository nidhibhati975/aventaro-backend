export interface UserProfile {
  name?: string | null;
  age?: number | null;
  bio?: string | null;
  location?: string | null;
  gender?: string | null;
  travel_style?: string | null;
  interests?: string[] | null;
  budget_min?: number | null;
  budget_max?: number | null;
}

export interface AppUser {
  id: number;
  email: string;
  created_at?: string;
  profile?: UserProfile | null;
  posts_count?: number;
  followers_count?: number;
  following_count?: number;
  saved_count?: number;
}

export interface MatchRecord {
  id: number;
  status: 'pending' | 'accepted' | 'rejected';
  direction: 'incoming' | 'outgoing';
  user: AppUser;
  compatibility_score?: number | null;
  compatibility_reason?: string | null;
}

export interface TripMemberRecord {
  user: AppUser;
  status: 'pending' | 'approved';
}

export interface TripRecord {
  id: number;
  title: string;
  location: string;
  capacity: number;
  owner: AppUser;
  members: TripMemberRecord[];
  approved_member_count: number;
  current_user_status?: 'pending' | 'approved' | null;
  budget_min?: number | null;
  budget_max?: number | null;
  interests?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  budget?: string | null;
}

export interface TripActivityRecord {
  id: number;
  trip_id: number;
  user?: AppUser | null;
  type: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface TripActivityPage {
  items: TripActivityRecord[];
  next_cursor?: string | null;
}

export interface ConversationSummary {
  id: string;
  type: 'direct' | 'group';
  title: string;
  participant: AppUser;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  unreadCount: number;
}

export interface ChatMessageRecord {
  id: number;
  conversation_id: string;
  conversationId?: string;
  content: string;
  created_at: string;
  createdAt?: string;
  message_status?: 'sent' | 'delivered' | 'read';
  messageStatus?: 'sent' | 'delivered' | 'read';
  read_at?: string | null;
  readAt?: string | null;
  sender: AppUser;
  recipient: AppUser;
}

export interface BookingRecord {
  id: string;
  type: 'hotel' | 'flight';
  title: string;
  subtitle?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
}

export interface NotificationRecord {
  id: number;
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
  type?: string;
  entity_id?: string | number | null;
}

export interface PaymentSessionResult {
  url?: string | null;
  status: 'success' | 'pending' | 'failed';
}

export interface SubscriptionRecord {
  user_id: number;
  plan_type: 'free' | 'premium';
  status: 'active' | 'canceled' | 'expired';
  current_period_end?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  is_premium: boolean;
  referral_code?: string | null;
}

export interface SubscriptionCheckoutSession {
  session_id: string;
  checkout_url: string;
  amount_total?: number | null;
  currency?: string | null;
}

export interface BoostRecord {
  id: number;
  user_id: number;
  boost_type: 'profile' | 'trip';
  expires_at: string;
  created_at: string;
}

export type SocialMediaType = 'image' | 'video';

export interface SocialPost {
  id: number;
  caption?: string | null;
  media_url: string | null;
  media_type: SocialMediaType;
  location?: string | null;
  watch_time: number;
  hashtags: string[];
  created_at: string;
  user: AppUser;
  likes_count: number;
  comments_count: number;
  liked_by_current_user: boolean;
  saved_by_current_user: boolean;
  is_following_author: boolean;
  is_owner: boolean;
}

export interface StoryRecord {
  id: number;
  media_url: string | null;
  media_type: SocialMediaType;
  created_at: string;
  expires_at: string;
  user: AppUser;
  viewed_by_current_user: boolean;
  is_seen: boolean;
  views_count: number;
  is_following_author: boolean;
  is_owner: boolean;
}

export interface StoryGroup {
  user_id: number;
  user: AppUser;
  stories: StoryRecord[];
  has_unseen: boolean;
}

export interface FeedPage<T> {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  next_cursor?: string | null;
}

export interface ReelWatchResult {
  post_id: number;
  watch_time: number;
  user_watch_time: number;
  completed: boolean;
  skipped: boolean;
}

export interface TripPlanActivity {
  day: number;
  activities: string[];
  estimated_cost: number;
}

export interface TripPlanOverview {
  headline: string;
  destination: string;
  duration_days: number;
  vibe: string;
  best_travel_window: string;
  stay_strategy: string;
  transport_strategy: string;
  personalization_notes: string[];
}

export interface TripDestinationSuggestion {
  destination: string;
  reason: string;
  best_for: string[];
  estimated_total_cost: number;
  ideal_days: number;
  best_travel_window: string;
}

export interface TripBudgetBreakdownItem {
  category: 'stay' | 'transport' | 'food' | 'activities' | 'buffer';
  label: string;
  amount: number;
  note: string;
}

export interface TripPlanResult {
  overview: TripPlanOverview;
  destination_suggestions: TripDestinationSuggestion[];
  budget_breakdown: TripBudgetBreakdownItem[];
  itinerary: TripPlanActivity[];
  total_estimated_cost: number;
  recommended_stays: string[];
  travel_routes: string[];
  tips: string[];
  follow_up_prompts: string[];
}

export type PlannerMood = 'chill' | 'adventure' | 'party' | 'luxury';
export type PlannerTripStatus = 'past' | 'active' | 'saved' | 'candidate';

export interface TravelerProfileContext {
  name?: string | null;
  home_base?: string | null;
  travel_style?: string | null;
  interests?: string[];
  budget_min?: number | null;
  budget_max?: number | null;
}

export interface TripContextSnapshot {
  title?: string | null;
  location: string;
  status: PlannerTripStatus;
  budget_min?: number | null;
  budget_max?: number | null;
  interests?: string[];
  start_date?: string | null;
  end_date?: string | null;
}

export interface AiPlannerRequest {
  budget: number;
  days: number;
  destination?: string | null;
  mood: PlannerMood;
  traveler_count?: number | null;
  travel_style?: string | null;
  profile_context?: TravelerProfileContext | null;
  past_trips?: TripContextSnapshot[];
  active_trip?: TripContextSnapshot | null;
  saved_destinations?: string[];
  candidate_destinations?: string[];
  must_include?: string[];
  avoid?: string[];
}

export interface AiChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiAssistantResponse {
  reply: string;
  trip_suggestions: string[];
  budget_tips: string[];
  next_steps: string[];
  trip_plan?: TripPlanResult | null;
  follow_up_prompts?: string[];
}

export function getUserDisplayName(user: AppUser | null | undefined): string {
  if (!user) {
    return 'Unknown traveler';
  }
  return user.profile?.name?.trim() || user.email;
}

export function getUserHandle(user: AppUser | null | undefined): string {
  if (!user?.email) {
    return '@aventaro';
  }

  const value = String(user.email).split('@')[0]?.trim() || 'aventaro';
  return value.startsWith('@') ? value : `@${value}`;
}

export function getUserInitials(user: AppUser | null | undefined): string {
  const name = getUserDisplayName(user);
  const parts = name
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return 'A';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase();
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}
