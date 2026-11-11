import type { paginateAlbums } from "../collectionView";
import { collectionPageSizes } from "../settings";

type PageSize = (typeof collectionPageSizes)[number];

export default function AlbumPagination({ label, pagination, total, unfilteredTotal, pageSize, onSize, onPage, favorites = false }: {
  label: string;
  pagination: ReturnType<typeof paginateAlbums>;
  total: number;
  unfilteredTotal: number;
  pageSize: PageSize;
  onSize: (size: PageSize) => void;
  onPage: (page: number) => void;
  favorites?: boolean;
}) {
  return (
    <nav className="collection-pagination" aria-label={label}>
      <div className="collection-page-summary">
        <div className="collection-page-size">
          <label htmlFor="collection-page-size">Albums per page</label>
          <select id="collection-page-size" value={pageSize} onChange={event => {
            const size = collectionPageSizes.find(value => value === event.target.value);
            if (size) onSize(size);
          }}>
            {collectionPageSizes.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </div>
        <span role="status">
          Showing {pagination.start + 1}–{pagination.end} of {total}{favorites ? " favorites" : ""}
          {total !== unfilteredTotal && ` (${unfilteredTotal} total)`}
        </span>
      </div>
      <div className="collection-page-buttons">
        <button type="button" className="album-cancel" disabled={pagination.pageIndex === 0}
          onClick={() => onPage(pagination.pageIndex - 1)}>Previous</button>
        <span>Page {pagination.pageIndex + 1} of {pagination.pageCount}</span>
        <button type="button" className="album-cancel" disabled={pagination.pageIndex + 1 === pagination.pageCount}
          onClick={() => onPage(pagination.pageIndex + 1)}>Next</button>
      </div>
    </nav>
  );
}
