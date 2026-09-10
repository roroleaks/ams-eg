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
      activity_events: {
        Row: {
          category: string
          complaint_id: string | null
          created_at: string
          event_type: string
          id: string
          immutable: boolean
          organization: string | null
          product_id: string | null
          reference_id: string | null
          report_id: string | null
          result_count: number | null
          session_id: string | null
          user_id: string | null
          user_role: string | null
        }
        Insert: {
          category: string
          complaint_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          immutable?: boolean
          organization?: string | null
          product_id?: string | null
          reference_id?: string | null
          report_id?: string | null
          result_count?: number | null
          session_id?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Update: {
          category?: string
          complaint_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          immutable?: boolean
          organization?: string | null
          product_id?: string | null
          reference_id?: string | null
          report_id?: string | null
          result_count?: number | null
          session_id?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Relationships: []
      }
      admin_audit_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json
          id: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json
          id?: string
          target_user_id?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      complaint_library: {
        Row: {
          built_at: string
          built_by: string | null
          complaint: string
          created_at: string
          error: string | null
          evidence: Json
          evidence_count: number
          id: string
          literature: Json
          literature_count: number
          product_count: number
          products: Json
          report_markdown: string | null
          status: string
        }
        Insert: {
          built_at?: string
          built_by?: string | null
          complaint: string
          created_at?: string
          error?: string | null
          evidence?: Json
          evidence_count?: number
          id?: string
          literature?: Json
          literature_count?: number
          product_count?: number
          products?: Json
          report_markdown?: string | null
          status?: string
        }
        Update: {
          built_at?: string
          built_by?: string | null
          complaint?: string
          created_at?: string
          error?: string | null
          evidence?: Json
          evidence_count?: number
          id?: string
          literature?: Json
          literature_count?: number
          product_count?: number
          products?: Json
          report_markdown?: string | null
          status?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          page: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          page?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          page?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          chunk_count: number
          created_at: string
          filename: string
          id: string
          indexed_at: string | null
          page_count: number | null
          status: Database["public"]["Enums"]["doc_status"]
          status_message: string | null
          storage_path: string
          title: string
          updated_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          chunk_count?: number
          created_at?: string
          filename: string
          id?: string
          indexed_at?: string | null
          page_count?: number | null
          status?: Database["public"]["Enums"]["doc_status"]
          status_message?: string | null
          storage_path: string
          title: string
          updated_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          chunk_count?: number
          created_at?: string
          filename?: string
          id?: string
          indexed_at?: string | null
          page_count?: number | null
          status?: Database["public"]["Enums"]["doc_status"]
          status_message?: string | null
          storage_path?: string
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          item_key: string
          item_type: string
          label: string | null
          payload: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_key: string
          item_type: string
          label?: string | null
          payload?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_key?: string
          item_type?: string
          label?: string | null
          payload?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      guest_events: {
        Row: {
          anon_id: string
          created_at: string
          event: string
          id: string
        }
        Insert: {
          anon_id: string
          created_at?: string
          event: string
          id?: string
        }
        Update: {
          anon_id?: string
          created_at?: string
          event?: string
          id?: string
        }
        Relationships: []
      }
      indexing_logs: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          document_id: string | null
          duration_ms: number | null
          id: string
          message: string | null
          status: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          duration_ms?: number | null
          id?: string
          message?: string | null
          status: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          duration_ms?: number | null
          id?: string
          message?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "indexing_logs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          full_name: string | null
          id: string
          last_active_at: string | null
          last_login_at: string
          last_sign_in_at: string
          provider: string | null
          provider_account_id: string | null
          report_count: number
          role: Database["public"]["Enums"]["app_role"]
          search_count: number
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          last_active_at?: string | null
          last_login_at?: string
          last_sign_in_at?: string
          provider?: string | null
          provider_account_id?: string | null
          report_count?: number
          role?: Database["public"]["Enums"]["app_role"]
          search_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          last_active_at?: string | null
          last_login_at?: string
          last_sign_in_at?: string
          provider?: string | null
          provider_account_id?: string | null
          report_count?: number
          role?: Database["public"]["Enums"]["app_role"]
          search_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      search_analytics: {
        Row: {
          created_at: string
          id: string
          mode: string | null
          query: string
          result_count: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          mode?: string | null
          query: string
          result_count?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string | null
          query?: string
          result_count?: number
          user_id?: string | null
        }
        Relationships: []
      }
      search_history: {
        Row: {
          created_at: string
          id: string
          products: string[]
          query: string
          report_markdown: string | null
          result_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          products?: string[]
          query: string
          report_markdown?: string | null
          result_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          products?: string[]
          query?: string
          report_markdown?: string | null
          result_count?: number
          user_id?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          can_download: boolean
          can_search: boolean
          can_summarize: boolean
          id: string
          notes: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          can_download?: boolean
          can_search?: boolean
          can_summarize?: boolean
          id?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          can_download?: boolean
          can_search?: boolean
          can_summarize?: boolean
          id?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          browser: string | null
          created_at: string
          device_type: string | null
          duration_seconds: number | null
          ended_at: string | null
          id: string
          last_seen_at: string
          operating_system: string | null
          referrer: string | null
          session_key: string
          started_at: string
          user_id: string
        }
        Insert: {
          browser?: string | null
          created_at?: string
          device_type?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          last_seen_at?: string
          operating_system?: string | null
          referrer?: string | null
          session_key: string
          started_at?: string
          user_id: string
        }
        Update: {
          browser?: string | null
          created_at?: string
          device_type?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          last_seen_at?: string
          operating_system?: string | null
          referrer?: string | null
          session_key?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      purge_old_sessions: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user" | "owner" | "medical_editor" | "registered"
      doc_status: "pending" | "processing" | "indexed" | "failed"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "user", "owner", "medical_editor", "registered"],
      doc_status: ["pending", "processing", "indexed", "failed"],
    },
  },
} as const
