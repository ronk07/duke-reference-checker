export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Reference {
  id: string;
  raw_text: string;
  title: string;
  authors: string[];
  year: string;
  venue: string;
  doi: string | null;
  urls: string[];
  page_number: number | null;
  bounding_box: BoundingBox | null;
  citation_number: number | null;
}

export interface ExtractedBibliography {
  text: string;
  startPage: number;
  endPage: number;
  references: Reference[];
}


