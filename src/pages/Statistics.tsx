import { memo, useMemo } from "react";
import ProfileHeader from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import type { Album } from "../types/Album";
import { collectionStatistics } from "../collectionStatistics";
import "./Statistics.css";

function Statistics({ profile, albums, onBrowseCollection }: {
  profile: Profile;
  albums: Album[];
  onBrowseCollection: () => void;
}) {
  const stats = useMemo(() => collectionStatistics(albums), [albums]);
  const maximum = Math.max(1, ...stats.growth.map(month => month.added));
  return (
    <div className="statistics-page">
      <ProfileHeader profile={profile} title="Statistics" />
      {stats.total === 0 ? (
        <div className="collection-empty">
          <h2>Your collection is empty</h2>
          <p>Add albums to see format totals, artist rankings, and collection growth.</p>
          <button type="button" onClick={onBrowseCollection}>Browse Collection</button>
        </div>
      ) : (
        <>
          <dl className="statistics-summary">
            <div className="settings-card"><dt>Total albums</dt><dd>{stats.total}</dd></div>
            <div className="settings-card"><dt>Favorites</dt><dd>{stats.favorites}</dd></div>
          </dl>
          <section className="settings-card statistics-section" aria-labelledby="format-statistics">
            <h2 className="section-title" id="format-statistics">Format distribution</h2>
            <ul className="statistics-formats">
              {stats.formats.map(({ format, count }) => (
                <li key={format}>
                  <span>{format || "Format unspecified"}</span>
                  <span>{count} · {Math.round(count / stats.total * 100)}%</span>
                  <div className="statistics-bar" aria-hidden="true"><span style={{ width: `${count / stats.total * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </section>
          <section className="settings-card statistics-section" aria-labelledby="growth-statistics">
            <h2 className="section-title" id="growth-statistics">Collection growth</h2>
            {stats.growth.length === 0 ? (
              <p>No acquisition dates recorded yet. Edit an album’s Date acquired to include it here.</p>
            ) : (
              <>
                <p>Monthly acquisitions for albums in your collection. Up to 24 months are shown.</p>
                {stats.undated > 0 && <p>{stats.undated} {stats.undated === 1 ? "album has" : "albums have"} no recorded acquisition date and {stats.undated === 1 ? "is" : "are"} excluded from the graph.</p>}
                {stats.earlier > 0 && <p>{stats.earlier} {stats.earlier === 1 ? "album was" : "albums were"} acquired before the months shown.</p>}
                <div className="statistics-growth" aria-hidden="true">
                  {stats.growth.map(({ month, added, cumulative }) => (
                    <div className="statistics-month" key={month} title={`${month} · ${added} acquired · ${cumulative} dated albums total`}>
                      <span>{added}</span>
                      <div className="statistics-column"><span style={{ height: `${added / maximum * 100}%` }} /></div>
                      <span>{month}</span>
                    </div>
                  ))}
                </div>
                <details className="statistics-data">
                  <summary>View monthly figures</summary>
                  <table>
                    <caption>Recorded acquisitions and cumulative dated albums</caption>
                    <thead><tr><th scope="col">Month</th><th scope="col">Acquired</th><th scope="col">Total</th></tr></thead>
                    <tbody>{stats.growth.map(({ month, added, cumulative }) => (
                      <tr key={month}><th scope="row">{month}</th><td>{added}</td><td>{cumulative}</td></tr>
                    ))}</tbody>
                  </table>
                </details>
              </>
            )}
          </section>
          <section className="settings-card statistics-section" aria-labelledby="artist-statistics">
            <h2 className="section-title" id="artist-statistics">Artist Rankings</h2>
            {stats.artists.length === 0 ? <p>Add artist names to your albums to see rankings.</p> : (
              <ol className="statistics-artists">
                {stats.artists.map(({ name, count }) => (
                  <li key={name}>
                    <div className="statistics-artist">
                      <span>{name}</span>
                      <span>{count} {count === 1 ? "copy" : "copies"}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default memo(Statistics);
