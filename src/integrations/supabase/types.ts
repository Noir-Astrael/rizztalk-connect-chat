export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_credentials: {
        Row: {
          failed_attempts: number
          force_rotate: boolean
          last_login_at: string | null
          password_changed_at: string
          password_expires_at: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          failed_attempts?: number
          force_rotate?: boolean
          last_login_at?: string | null
          password_changed_at?: string
          password_expires_at?: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          failed_attempts?: number
          force_rotate?: boolean
          last_login_at?: string | null
          password_changed_at?: string
          password_expires_at?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_signals: {
        Row: {
          conversation_id: string | null
          created_at: string
          details: Json
          id: string
          profile_id: string
          score: number
          signal_type: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          profile_id: string
          score: number
          signal_type: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          profile_id?: string
          score?: number
          signal_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_signals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_signals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ended_at: string | null
          ended_by: string | null
          id: string
          match_score: number
          same_province: boolean
          started_at: string
          status: Database["public"]["Enums"]["conversation_status"]
          user_a: string
          user_b: string
        }
        Insert: {
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          match_score?: number
          same_province?: boolean
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          user_a: string
          user_b: string
        }
        Update: {
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          match_score?: number
          same_province?: boolean
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_queue: {
        Row: {
          gender: Database["public"]["Enums"]["gender_type"] | null
          gender_preference: Database["public"]["Enums"]["gender_preference"]
          id: string
          is_premium: boolean
          joined_at: string
          profile_id: string
          province_code: string | null
          status: Database["public"]["Enums"]["queue_status"]
          updated_at: string
        }
        Insert: {
          gender?: Database["public"]["Enums"]["gender_type"] | null
          gender_preference?: Database["public"]["Enums"]["gender_preference"]
          id?: string
          is_premium?: boolean
          joined_at?: string
          profile_id: string
          province_code?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Update: {
          gender?: Database["public"]["Enums"]["gender_type"] | null
          gender_preference?: Database["public"]["Enums"]["gender_preference"]
          id?: string
          is_premium?: boolean
          joined_at?: string
          profile_id?: string
          province_code?: string | null
          status?: Database["public"]["Enums"]["queue_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_queue_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
          telegram_message_id: number | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
          telegram_message_id?: number | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
          telegram_message_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          admin_note: string | null
          ai_validation: Json | null
          amount_idr: number
          created_at: string
          extracted_amount_idr: number | null
          id: string
          method: string
          payment_kind: string
          plan: string
          profile_id: string
          proof_image_file_id: string | null
          proof_image_url: string | null
          proof_note: string | null
          reference_code: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          target_severity: string | null
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          ai_validation?: Json | null
          amount_idr: number
          created_at?: string
          extracted_amount_idr?: number | null
          id?: string
          method?: string
          payment_kind?: string
          plan?: string
          profile_id: string
          proof_image_file_id?: string | null
          proof_image_url?: string | null
          proof_note?: string | null
          reference_code: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_severity?: string | null
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          ai_validation?: Json | null
          amount_idr?: number
          created_at?: string
          extracted_amount_idr?: number | null
          id?: string
          method?: string
          payment_kind?: string
          plan?: string
          profile_id?: string
          proof_image_file_id?: string | null
          proof_image_url?: string | null
          proof_note?: string | null
          reference_code?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_severity?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          alias: string
          auth_user_id: string | null
          ban_reason: string | null
          ban_severity: string | null
          bio: string | null
          birth_year: number | null
          created_at: string
          gender: Database["public"]["Enums"]["gender_type"] | null
          gender_preference: Database["public"]["Enums"]["gender_preference"]
          id: string
          is_banned_until: string | null
          is_premium: boolean
          language_code: string
          last_seen_at: string
          monthly_unban_credit_reset_at: string
          monthly_unban_credit_used: boolean
          no_ai: boolean
          onboarding_completed: boolean
          onboarding_step: string | null
          pending_payment_ref: string | null
          premium_until: string | null
          province_code: string | null
          province_name: string | null
          telegram_chat_id: number
          telegram_user_id: number
          telegram_username: string | null
          trust_score: number
          updated_at: string
        }
        Insert: {
          alias: string
          auth_user_id?: string | null
          ban_reason?: string | null
          ban_severity?: string | null
          bio?: string | null
          birth_year?: number | null
          created_at?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          gender_preference?: Database["public"]["Enums"]["gender_preference"]
          id?: string
          is_banned_until?: string | null
          is_premium?: boolean
          language_code?: string
          last_seen_at?: string
          monthly_unban_credit_reset_at?: string
          monthly_unban_credit_used?: boolean
          no_ai?: boolean
          onboarding_completed?: boolean
          onboarding_step?: string | null
          pending_payment_ref?: string | null
          premium_until?: string | null
          province_code?: string | null
          province_name?: string | null
          telegram_chat_id: number
          telegram_user_id: number
          telegram_username?: string | null
          trust_score?: number
          updated_at?: string
        }
        Update: {
          alias?: string
          auth_user_id?: string | null
          ban_reason?: string | null
          ban_severity?: string | null
          bio?: string | null
          birth_year?: number | null
          created_at?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          gender_preference?: Database["public"]["Enums"]["gender_preference"]
          id?: string
          is_banned_until?: string | null
          is_premium?: boolean
          language_code?: string
          last_seen_at?: string
          monthly_unban_credit_reset_at?: string
          monthly_unban_credit_used?: boolean
          no_ai?: boolean
          onboarding_completed?: boolean
          onboarding_step?: string | null
          pending_payment_ref?: string | null
          premium_until?: string | null
          province_code?: string | null
          province_name?: string | null
          telegram_chat_id?: number
          telegram_user_id?: number
          telegram_username?: string | null
          trust_score?: number
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          id: string
          profile_id: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          id?: string
          profile_id: string
          window_start?: string
        }
        Update: {
          bucket?: string
          count?: number
          id?: string
          profile_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bot_state: {
        Row: {
          id: number
          last_polled_at: string | null
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          last_polled_at?: string | null
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          last_polled_at?: string | null
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_updates_log: {
        Row: {
          chat_id: number | null
          from_user_id: number | null
          processed_at: string
          raw_update: Json
          update_id: number
        }
        Insert: {
          chat_id?: number | null
          from_user_id?: number | null
          processed_at?: string
          raw_update: Json
          update_id: number
        }
        Update: {
          chat_id?: number | null
          from_user_id?: number | null
          processed_at?: string
          raw_update?: Json
          update_id?: number
        }
        Relationships: []
      }
      trust_events: {
        Row: {
          conversation_id: string | null
          created_at: string
          delta: number
          duration_sec: number | null
          event_type: string
          id: string
          new_score: number
          profile_id: string
          reason: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          delta: number
          duration_sec?: number | null
          event_type: string
          id?: string
          new_score: number
          profile_id: string
          reason: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          delta?: number
          duration_sec?: number | null
          event_type?: string
          id?: string
          new_score?: number
          profile_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trust_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_interests: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["interest_kind"]
          profile_id: string
          tag: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["interest_kind"]
          profile_id: string
          tag: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["interest_kind"]
          profile_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_interests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          conversation_id: string | null
          created_at: string
          id: string
          note: string | null
          reason: Database["public"]["Enums"]["report_reason"]
          reported_id: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reported_id: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          reason?: Database["public"]["Enums"]["report_reason"]
          reported_id?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reported_id_fkey"
            columns: ["reported_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          event: string
          id: string
          level: string
          message: string | null
          payload: Json | null
          source: string
          status_code: number | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          event: string
          id?: string
          level?: string
          message?: string | null
          payload?: Json | null
          source: string
          status_code?: number | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          event?: string
          id?: string
          level?: string
          message?: string | null
          payload?: Json | null
          source?: string
          status_code?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_admin_role: { Args: { _target_email: string }; Returns: Json }
      admin_cancel_bot_signal: {
        Args: { _admin_id: string; _signal_id: string }
        Returns: boolean
      }
      admin_daily_conversations: {
        Args: { _days?: number }
        Returns: {
          count: number
          day: string
        }[]
      }
      admin_daily_signups: {
        Args: { _days?: number }
        Returns: {
          count: number
          day: string
        }[]
      }
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_password_meta: { Args: { _profile_id?: string }; Returns: Json }
      apply_trust_score_change: {
        Args: { _delta: number; _profile_id: string }
        Returns: number
      }
      approve_premium_payment: {
        Args: {
          _admin_id?: string
          _admin_note?: string
          _days?: number
          _reference_code: string
        }
        Returns: boolean
      }
      approve_unban_payment: {
        Args: {
          _admin_id?: string
          _admin_note?: string
          _reference_code: string
        }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          _bucket: string
          _max_count: number
          _profile_id: string
          _window_seconds: number
        }
        Returns: boolean
      }
      current_profile_id: { Args: never; Returns: string }
      find_or_create_profile_by_telegram_id: {
        Args: {
          _alias: string
          _language_code?: string
          _telegram_chat_id: number
          _telegram_user_id: number
          _telegram_username: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _profile_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      link_admin_auth_user: {
        Args: { _auth_user_id: string; _email: string }
        Returns: string
      }
      link_owner_auth_user: {
        Args: { _auth_user_id: string; _email: string }
        Returns: string
      }
      list_admins: {
        Args: never
        Returns: {
          alias: string
          email: string
          is_owner: boolean
          last_login_at: string
          password_changed_at: string
          password_expires_at: string
          profile_id: string
        }[]
      }
      mark_admin_password_changed: { Args: never; Returns: Json }
      owner_active_sessions: {
        Args: never
        Returns: {
          conversation_id: string
          last_message_at: string
          message_count: number
          started_at: string
          user_a_alias: string
          user_a_tg: number
          user_b_alias: string
          user_b_tg: number
        }[]
      }
      owner_session_messages: {
        Args: { _conversation_id: string; _limit?: number }
        Returns: {
          content: string
          created_at: string
          id: string
          sender_alias: string
          sender_tg: number
        }[]
      }
      purge_old_messages: { Args: never; Returns: number }
      record_trust_event: {
        Args: {
          _conversation_id?: string
          _delta: number
          _duration_sec?: number
          _event_type: string
          _profile_id: string
          _reason: string
        }
        Returns: number
      }
      record_webhook_event: {
        Args: {
          _duration_ms?: number
          _event: string
          _level: string
          _message: string
          _payload?: Json
          _source: string
          _status_code?: number
        }
        Returns: string
      }
      reject_premium_payment: {
        Args: {
          _admin_id?: string
          _admin_note?: string
          _reference_code: string
        }
        Returns: boolean
      }
      reject_unban_payment: {
        Args: {
          _admin_id?: string
          _admin_note?: string
          _reference_code: string
        }
        Returns: boolean
      }
      remove_admin_role: { Args: { _target_email: string }; Returns: Json }
      request_premium_upgrade: {
        Args: { _amount_idr: number; _plan: string; _profile_id: string }
        Returns: string
      }
      request_unban: {
        Args: { _profile_id: string; _severity: string }
        Returns: Json
      }
      reset_monthly_unban_credits: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "owner"
      conversation_status: "active" | "ended"
      gender_preference: "male" | "female" | "any"
      gender_type: "male" | "female" | "other"
      interest_kind: "preset" | "custom"
      queue_status: "waiting" | "matched" | "cancelled"
      report_reason: "spam" | "nsfw" | "bot" | "scam" | "harassment" | "other"
      report_status: "pending" | "reviewed" | "dismissed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "owner"],
      conversation_status: ["active", "ended"],
      gender_preference: ["male", "female", "any"],
      gender_type: ["male", "female", "other"],
      interest_kind: ["preset", "custom"],
      queue_status: ["waiting", "matched", "cancelled"],
      report_reason: ["spam", "nsfw", "bot", "scam", "harassment", "other"],
      report_status: ["pending", "reviewed", "dismissed"],
    },
  },
} as const
