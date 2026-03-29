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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      cases: {
        Row: {
          ai_angle: string | null
          ai_solution: string
          audience_role: string | null
          business_context: string | null
          created_at: string
          example_answer: string | null
          id: string
          is_active: boolean | null
          problem: string
          symptoms: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          ai_angle?: string | null
          ai_solution: string
          audience_role?: string | null
          business_context?: string | null
          created_at?: string
          example_answer?: string | null
          id?: string
          is_active?: boolean | null
          problem: string
          symptoms?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          ai_angle?: string | null
          ai_solution?: string
          audience_role?: string | null
          business_context?: string | null
          created_at?: string
          example_answer?: string | null
          id?: string
          is_active?: boolean | null
          problem?: string
          symptoms?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      conversation_messages: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          id: string
          message_text: string
          retrieval_json: Json | null
          role: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_text: string
          retrieval_json?: Json | null
          role: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          message_text?: string
          retrieval_json?: Json | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_message: string
          created_at: string
          id: string
          page: string | null
          session_id: string | null
          user_message: string
        }
        Insert: {
          ai_message: string
          created_at?: string
          id?: string
          page?: string | null
          session_id?: string | null
          user_message: string
        }
        Update: {
          ai_message?: string
          created_at?: string
          id?: string
          page?: string | null
          session_id?: string | null
          user_message?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          document_id: string | null
          id: string
          metadata_json: Json | null
          token_estimate: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          document_id?: string | null
          id?: string
          metadata_json?: Json | null
          token_estimate?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          document_id?: string | null
          id?: string
          metadata_json?: Json | null
          token_estimate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata_json: Json | null
          normalized_text: string | null
          raw_text: string | null
          source: string | null
          source_name: string | null
          source_ref: string | null
          source_type: string | null
          status: string | null
          title: string | null
          topic: string | null
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata_json?: Json | null
          normalized_text?: string | null
          raw_text?: string | null
          source?: string | null
          source_name?: string | null
          source_ref?: string | null
          source_type?: string | null
          status?: string | null
          title?: string | null
          topic?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata_json?: Json | null
          normalized_text?: string | null
          raw_text?: string | null
          source?: string | null
          source_name?: string | null
          source_ref?: string | null
          source_type?: string | null
          status?: string | null
          title?: string | null
          topic?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      knowledge_docs: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata_json: Json | null
          normalized_text: string | null
          raw_text: string | null
          source: string | null
          source_name: string | null
          source_ref: string | null
          source_type: string | null
          status: string | null
          title: string | null
          topic: string | null
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata_json?: Json | null
          normalized_text?: string | null
          raw_text?: string | null
          source?: string | null
          source_name?: string | null
          source_ref?: string | null
          source_type?: string | null
          status?: string | null
          title?: string | null
          topic?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata_json?: Json | null
          normalized_text?: string | null
          raw_text?: string | null
          source?: string | null
          source_name?: string | null
          source_ref?: string | null
          source_type?: string | null
          status?: string | null
          title?: string | null
          topic?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      factory_flows: {
        Row: {
          created_at: string
          description: string | null
          factory: string
          id: string
          name: string
          status: string
          target_company_size: string | null
          target_industry: string | null
          target_notes: string | null
          target_region: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          factory: string
          id?: string
          name: string
          status?: string
          target_company_size?: string | null
          target_industry?: string | null
          target_notes?: string | null
          target_region?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          factory?: string
          id?: string
          name?: string
          status?: string
          target_company_size?: string | null
          target_industry?: string | null
          target_notes?: string | null
          target_region?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      insights: {
        Row: {
          action_proposal: string | null
          company_name: string | null
          created_at: string
          id: string
          notes: string | null
          opportunity_type: Database["public"]["Enums"]["opportunity_type"]
          problem: string | null
          signal_id: string | null
          status: string
          title: string
          updated_at: string | null
          what_happens: string
          why_important: string | null
        }
        Insert: {
          action_proposal?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          opportunity_type?: Database["public"]["Enums"]["opportunity_type"]
          problem?: string | null
          signal_id?: string | null
          status?: string
          title: string
          updated_at?: string | null
          what_happens: string
          why_important?: string | null
        }
        Update: {
          action_proposal?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          opportunity_type?: Database["public"]["Enums"]["opportunity_type"]
          problem?: string | null
          signal_id?: string | null
          status?: string
          title?: string
          updated_at?: string | null
          what_happens?: string
          why_important?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insights_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          company_name: string | null
          company_size: string | null
          conversation_id: string | null
          created_at: string
          id: string
          lead_summary: string | null
          message: string
          name: string | null
          page: string | null
          role: string | null
          session_id: string | null
          status: string | null
          telegram_message_id: string | null
          telegram_sent: boolean | null
          topic_guess: string | null
        }
        Insert: {
          company_name?: string | null
          company_size?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_summary?: string | null
          message: string
          name?: string | null
          page?: string | null
          role?: string | null
          session_id?: string | null
          status?: string | null
          telegram_message_id?: string | null
          telegram_sent?: boolean | null
          topic_guess?: string | null
        }
        Update: {
          company_name?: string | null
          company_size?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_summary?: string | null
          message?: string
          name?: string | null
          page?: string | null
          role?: string | null
          session_id?: string | null
          status?: string | null
          telegram_message_id?: string | null
          telegram_sent?: boolean | null
          topic_guess?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          calendly_url: string | null
          embedding_model: string | null
          first_message: string | null
          id: string
          openai_model: string | null
          system_prompt: string | null
          telegram_bot_token: string | null
          telegram_chat_id: string | null
          temperature: number | null
          top_k: number | null
          updated_at: string | null
        }
        Insert: {
          calendly_url?: string | null
          embedding_model?: string | null
          first_message?: string | null
          id?: string
          openai_model?: string | null
          system_prompt?: string | null
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          temperature?: number | null
          top_k?: number | null
          updated_at?: string | null
        }
        Update: {
          calendly_url?: string | null
          embedding_model?: string | null
          first_message?: string | null
          id?: string
          openai_model?: string | null
          system_prompt?: string | null
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          temperature?: number | null
          top_k?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      signals: {
        Row: {
          company_name: string | null
          created_at: string
          description: string
          id: string
          industry: string | null
          notes: string | null
          potential: Database["public"]["Enums"]["opportunity_type"] | null
          priority: number | null
          signal_type: Database["public"]["Enums"]["signal_type"]
          source: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          description: string
          id?: string
          industry?: string | null
          notes?: string | null
          potential?: Database["public"]["Enums"]["opportunity_type"] | null
          priority?: number | null
          signal_type?: Database["public"]["Enums"]["signal_type"]
          source?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string
          description?: string
          id?: string
          industry?: string | null
          notes?: string | null
          potential?: Database["public"]["Enums"]["opportunity_type"] | null
          priority?: number | null
          signal_type?: Database["public"]["Enums"]["signal_type"]
          source?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      startup_opportunities: {
        Row: {
          complexity: string | null
          created_at: string
          id: string
          idea: string
          insight_id: string | null
          market: string | null
          monetization: string | null
          mvp_timeline: string | null
          notes: string | null
          problem: string | null
          revenue_estimate: number | null
          signal_id: string | null
          solution: string | null
          source: string | null
          stage: Database["public"]["Enums"]["startup_stage"]
          updated_at: string | null
        }
        Insert: {
          complexity?: string | null
          created_at?: string
          id?: string
          idea: string
          insight_id?: string | null
          market?: string | null
          monetization?: string | null
          mvp_timeline?: string | null
          notes?: string | null
          problem?: string | null
          revenue_estimate?: number | null
          signal_id?: string | null
          solution?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["startup_stage"]
          updated_at?: string | null
        }
        Update: {
          complexity?: string | null
          created_at?: string
          id?: string
          idea?: string
          insight_id?: string | null
          market?: string | null
          monetization?: string | null
          mvp_timeline?: string | null
          notes?: string | null
          problem?: string | null
          revenue_estimate?: number | null
          signal_id?: string | null
          solution?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["startup_stage"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "startup_opportunities_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "startup_opportunities_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      opportunity_type: "consulting" | "foundry" | "innovation_pilot"
      signal_type: "company" | "founder" | "startup" | "tech"
      startup_stage:
        | "opportunity"
        | "concept"
        | "mvp"
        | "test"
        | "live"
        | "killed"
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
      opportunity_type: ["consulting", "foundry", "innovation_pilot"],
      signal_type: ["company", "founder", "startup", "tech"],
      startup_stage: [
        "opportunity",
        "concept",
        "mvp",
        "test",
        "live",
        "killed",
      ],
    },
  },
} as const
