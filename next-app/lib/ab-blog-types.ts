export type BlogTag = { id: number; slug: string; label: string };

export type BlogMediaItem = {
  id: number;
  url: string;
  mime: string | null;
};

export const BLOG_MEDIA_MAX = 10;

export type BlogPost = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  body_html: string;
  cover_url: string;
  cover_mime: string | null;
  keywords: string;
  author_user_id: number | null;
  status: string;
  published_at: number | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  created_at: number;
  updated_at: number;
  tags: BlogTag[];
  media: BlogMediaItem[];
  liked_by_me?: boolean;
};

export type BlogCommentSort = "top" | "new";

/** Сколько комментариев подгружать за один запрос. */
export const BLOG_COMMENTS_PAGE_SIZE = 12;

export type BlogComment = {
  id: number;
  post_id: number;
  user_id: number;
  body: string;
  parent_id: number | null;
  created_at: number;
  user_name: string;
  like_count: number;
  liked_by_me?: boolean;
};
