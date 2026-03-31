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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_feedback: {
        Row: {
          content: string | null
          created_at: string
          factory: string | null
          feedback_type: string | null
          from_agent: string | null
          id: string
          insight_id: string | null
          resolved: boolean | null
          signal_id: string | null
          to_agent: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          factory?: string | null
          feedback_type?: string | null
          from_agent?: string | null
          id?: string
          insight_id?: string | null
          resolved?: boolean | null
          signal_id?: string | null
          to_agent?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          factory?: string | null
          feedback_type?: string | null
          from_agent?: string | null
          id?: string
          insight_id?: string | null
          resolved?: boolean | null
          signal_id?: string | null
          to_agent?: string | null
        }
        Relationships: []
      }
      agent_kpi: {
        Row: {
          active: boolean | null
          created_at: string
          current: number | null
          factory: string | null
          id: string
          metric: string | null
          target: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          current?: number | null
          factory?: string | null
          id?: string
          metric?: string | null
          target?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          created_at?: string
          current?: number | null
          factory?: string | null
          id?: string
          metric?: string | null
          target?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      assistant_prompts: {
        Row: {
          active: boolean | null
          created_at: string
          id: string
          site_id: string
          system_prompt: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          id?: string
          site_id: string
          system_prompt?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          created_at?: string
          id?: string
          site_id?: string
          system_prompt?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json | null
          site_id: string | null
          updated_at: string
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json | null
          site_id?: string | null
          updated_at?: string
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json | null
          site_id?: string | null
          updated_at?: string
          visitor_id?: string | null
        }
        Relationships: []
      }
      factory_flows: {
        Row: {
          created_at: string
          factory: string
          id: string
          status: string
          target_company_size: string | null
          target_industry: string | null
          target_notes: string | null
          target_region: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          factory?: string
          id?: string
          status?: string
          target_company_size?: string | null
          target_industry?: string | null
          target_notes?: string | null
          target_region?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          factory?: string
          id?: string
          status?: string
          target_company_size?: string | null
          target_industry?: string | null
          target_notes?: string | null
          target_region?: string | null
          updated_at?: string
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
          opportunity_type: string | null
          problem: string | null
          signal_id: string | null
          status: string
          title: string
          updated_at: string
          what_happens: string | null
          why_important: string | null
        }
        Insert: {
          action_proposal?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          opportunity_type?: string | null
          problem?: string | null
          signal_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          what_happens?: string | null
          why_important?: string | null
        }
        Update: {
          action_proposal?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          opportunity_type?: string | null
          problem?: string | null
          signal_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          what_happens?: string | null
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
          created_at: string
          id: string
          lead_summary: string | null
          message: string | null
          name: string | null
          role: string | null
          status: string
          topic_guess: string | null
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          id?: string
          lead_summary?: string | null
          message?: string | null
          name?: string | null
          role?: string | null
          status?: string
          topic_guess?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          id?: string
          lead_summary?: string | null
          message?: string | null
          name?: string | null
          role?: string | null
          status?: string
          topic_guess?: string | null
          updated_at?: string
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
          potential: string | null
          signal_type: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          description?: string
          id?: string
          industry?: string | null
          notes?: string | null
          potential?: string | null
          signal_type?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          description?: string
          id?: string
          industry?: string | null
          notes?: string | null
          potential?: string | null
          signal_type?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      startup_opportunities: {
        Row: {
          complexity: string | null
          created_at: string
          id: string
          idea: string | null
          insight_id: string | null
          market: string | null
          monetization: string | null
          notes: string | null
          problem: string | null
          revenue_estimate: number | null
          solution: string | null
          source: string | null
          stage: string | null
          updated_at: string
        }
        Insert: {
          complexity?: string | null
          created_at?: string
          id?: string
          idea?: string | null
          insight_id?: string | null
          market?: string | null
          monetization?: string | null
          notes?: string | null
          problem?: string | null
          revenue_estimate?: number | null
          solution?: string | null
          source?: string | null
          stage?: string | null
          updated_at?: string
        }
        Update: {
          complexity?: string | null
          created_at?: string
          id?: string
          idea?: string | null
          insight_id?: string | null
          market?: string | null
          monetization?: string | null
          notes?: string | null
          problem?: string | null
          revenue_estimate?: number | null
          solution?: string | null
          source?: string | null
          stage?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "startup_opportunities_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "insights"
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
      [_ in never]: never
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
    Enums: {},
  },
} as const
