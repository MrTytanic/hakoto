import { useMemo } from "react";
import ProfileHeader from "../components/ProfileHeader";
import type { Profile } from "../types/Profile";
import type { Album } from "../types/Album";
import { collectionStatistics } from "../collectionStatistics";
import "./Statistics.css";

function Statistics({ profile, albums }: { profile: Profile; albums: Album[] }) {
  const stats = useMemo(() => collectionStatistics(albums), [albums]);
  const maximum = Math.max(1, ...stats.growth.map(month => month.added));
  return (
    <div className="statistics-page">
      <ProfileHeader profile={profile} title="Statistics" />
      {stats.total === 0 ? (
        <div className="collection-empty">
          <h2>Your collection is empty</h2>
          <p>Add albums to see format totals and collection growth.</p>
        </div>
      ) : (
        <>
          <dl className="statistics-summary">
            <div className="settings-card"><dt>Total albums</dt><dd>{stats.total}</dd></div>
            <div className="settings-card"><dt>Favorites</dt><dd>{stats.favorites}</dd></div>
          </dl>
          <section className="settings-card statistics-section" aria-labelledby="format-statistics">
            <h2 id="format-statistics">Format distribution</h2>
            <ul className="statistics-formats">
              {stats.formats.map(({ format, count }) => (
                <li key={format}>
                  <span>{format}</span>
                  <span>{count} · {Math.round(count / stats.total * 100)}%</span>
                  <div className="statistics-bar" aria-hidden="true"><span style={{ width: `${count / stats.total * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </section>
          <section className="settings-card statistics-section" aria-labelledby="growth-statistics">
            <h2 id="growth-statistics">Collection growth</h2>
            <p>Monthly additions use the acquisition date when recorded and otherwise use the date the album was added. Up to 24 months are shown.</p>
            {stats.undated > 0 && <p>{stats.undated} {stats.undated === 1 ? "album has" : "albums have"} no recorded date and {stats.undated === 1 ? "is" : "are"} excluded from the graph.</p>}
            {stats.earlier > 0 && <p>{stats.earlier} dated albums were added before the months shown.</p>}
            {stats.growth.length === 0 ? <p>No recorded dates yet. Newly added albums will appear here.</p> : (
              <>
                <div className="statistics-growth" aria-hidden="true">
                  {stats.growth.map(({ month, added, cumulative }) => (
                    <div className="statistics-month" key={month} title={`${month} · ${added} added · ${cumulative} dated albums total`}>
                      <span>{added}</span>
                      <div className="statistics-column"><span style={{ height: `${added / maximum * 100}%` }} /></div>
                      <span>{month}</span>
                    </div>
                  ))}
                </div>
                <details className="statistics-data">
                  <summary>View monthly figures</summary>
                  <table>
                    <caption>Recorded additions and cumulative dated albums</caption>
                    <thead><tr><th scope="col">Month</th><th scope="col">Added</th><th scope="col">Total</th></tr></thead>
                    <tbody>{stats.growth.map(({ month, added, cumulative }) => (
                      <tr key={month}><th scope="row">{month}</th><td>{added}</td><td>{cumulative}</td></tr>
                    ))}</tbody>
                  </table>
                </details>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default Statistics;
