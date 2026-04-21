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
      profiles: {
        Row: {
          alias: string
          ban_reason: string | null
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
          onboarding_completed: boolean
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
          ban_reason?: string | null
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
          onboarding_completed?: boolean
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
          ban_reason?: string | null
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
          onboarding_completed?: boolean
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_trust_score_change: {
        Args: { _delta: number; _profile_id: string }
        Returns: number
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
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
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
