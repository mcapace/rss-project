export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type IssueStatus =
  | "queued"
  | "processing"
  | "review"
  | "published"
  | "failed";

export interface Database {
  public: {
    Tables: {
      issues: {
        Row: {
          id: string;
          brand: string;
          issue_id: string;
          issue_label: string;
          pdf_key: string;
          toc_pages: number[] | null;
          status: IssueStatus;
          stats: Json | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          brand: string;
          issue_id: string;
          issue_label: string;
          pdf_key: string;
          toc_pages?: number[] | null;
          status?: IssueStatus;
          stats?: Json | null;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          brand?: string;
          issue_id?: string;
          issue_label?: string;
          pdf_key?: string;
          toc_pages?: number[] | null;
          status?: IssueStatus;
          stats?: Json | null;
          error?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      articles: {
        Row: {
          id: string;
          issue_uuid: string;
          sort_order: number;
          title: string;
          section: string | null;
          author: string | null;
          pdf_pages: number[] | null;
          html: string;
          include: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          issue_uuid: string;
          sort_order: number;
          title: string;
          section?: string | null;
          author?: string | null;
          pdf_pages?: number[] | null;
          html: string;
          include?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          issue_uuid?: string;
          sort_order?: number;
          title?: string;
          section?: string | null;
          author?: string | null;
          pdf_pages?: number[] | null;
          html?: string;
          include?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "articles_issue_uuid_fkey";
            columns: ["issue_uuid"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          }
        ];
      };
      article_images: {
        Row: {
          id: string;
          article_uuid: string;
          s3_key: string;
          width: number | null;
          height: number | null;
          sort_order: number;
          include: boolean;
          is_lead: boolean;
        };
        Insert: {
          id?: string;
          article_uuid: string;
          s3_key: string;
          width?: number | null;
          height?: number | null;
          sort_order?: number;
          include?: boolean;
          is_lead?: boolean;
        };
        Update: {
          id?: string;
          article_uuid?: string;
          s3_key?: string;
          width?: number | null;
          height?: number | null;
          sort_order?: number;
          include?: boolean;
          is_lead?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "article_images_article_uuid_fkey";
            columns: ["article_uuid"];
            isOneToOne: false;
            referencedRelation: "articles";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      issue_status: IssueStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

export type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
export type IssueInsert = Database["public"]["Tables"]["issues"]["Insert"];
export type IssueUpdate = Database["public"]["Tables"]["issues"]["Update"];

export type ArticleRow = Database["public"]["Tables"]["articles"]["Row"];
export type ArticleInsert = Database["public"]["Tables"]["articles"]["Insert"];
export type ArticleUpdate = Database["public"]["Tables"]["articles"]["Update"];

export type ArticleImageRow = Database["public"]["Tables"]["article_images"]["Row"];
export type ArticleImageInsert = Database["public"]["Tables"]["article_images"]["Insert"];
export type ArticleImageUpdate = Database["public"]["Tables"]["article_images"]["Update"];
