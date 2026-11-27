| `bash tests/run.sh drawer` | the ☰ drawer with a synthetic interfering stylesheet, and phone → desktop → phone without reloading | about 3 minutes |
# Mobile Dashboard automated tests

The suite repeats the plugin's checks automatically, so that a future change cannot silently break something that used to work.
It runs **only against a local OJS 3.5 copy in Docker**, never against a live site: if the address is not `localhost`, it stops.

## How to run it

1. Start Docker Desktop and the local copy (`docker compose up -d` in its folder).
2. From Git Bash, in the repository root:

```bash
MD_LOCALE=/path/to/the/docker/copy bash tests/run.sh
```

It needs Node.js 22 or later and Google Chrome, Chromium or Microsoft Edge. It takes about 16 minutes. At the end it prints `RESULT: all N tests passed` (exit code 0) or the list of failed tests.

You can also run a single group, or several:

| Command | What it checks | Duration |
|---|---|---|
| `bash tests/run.sh static` | files and code, no browser | about 1 minute |
| `bash tests/run.sh phone` | back-end pages at 390×844 (phone) | about 6 minutes |
| `bash tests/run.sh desktop` | 17 pages at 1300 px, with and without the plugin | about 8 minutes |

Each run includes about one minute to back up and prepare the local copy and then restore it.

## What it does

1. Checks that mail in the local copy's `config.inc.php` is set to `default = log`. If not, it stops: **no email is actually sent**.
2. Backs up the local copy's database and the `plugins/generic/mobileDashboard` folder (if present).
3. Replaces names, email addresses, titles and journal names with **placeholder data** (`placeholders.sql`), so the images in `tests/results/` show no real data.
4. Installs the plugin from this repository (only the package files: `MobileDashboardPlugin.php`, `index.php`, `version.xml`, `styles/`, `locale/`), enables it for the site and disables any plugins listed in `MD_DISABLE`.
5. At the end it **restores everything** (database, plugin folder, cache), even if a test fails or the suite is interrupted with Ctrl+C. If new files appeared in the OJS files folder in the meantime, it reports them.

## What it covers

- **Static:** version format, plugin name and class; `php -l` and `node --check` on all files; the same strings in English and Italian, and every string used in the PHP present in English; no rule in `mobile.css` that changes the desktop (everything is inside `@media (max-width: 900px)`, except elements created by the plugin); files loaded with the plugin enabled and not loaded with it disabled.
- **Phone:**
  - Layout: no page wider than the screen and no content cut off outside it.
  - Menus: the ☰ menu opens inside the screen, reaches the last item and closes when tapping outside. A header button such as the journal switcher closes ☰. The workflow stage menu opens and closes again when a stage is chosen.
  - Tables and lists:
    - Tables become cards with labels.
    - In the plugin lists (journal, Plugin Gallery, Administration), name and checkbox share a row and the description is shown in full.
    - Users & Roles shows the name in bold at the top, with each date next to its role.
    - Tasks, statistics and lists (Counter R5, Announcements, Institutions) have no boxes inside boxes and no repeated headings, with Export on the heading row.
    - DOIs has no heading repeating the tab.
  - Forms:
    - Settings boxes are wide enough.
    - Profile fields (Identity, Contact) are as wide as the form, one per row.
    - Multilingual fields show each language one below the other.
    - In side panels with a form, both new (Hosted Journals > Edit) and old (Create Section), labels and fields are away from the edge.
  - Tabs: tabs stay on one row that scrolls sideways and stays below the header, with the active tab joined to its panel.
  - Swipe with simulated touches changes tab:
    - inner tabs first, then outer ones;
    - also slightly diagonal, over a grid, and on the grey page below a short panel;
    - in the Profile and in Appearance > Setup, which has the same id as Site Setup;
    - on a text field only if it is not focused.
    - Vertical dragging only scrolls the page.
  - Tab indicators: after a tap and a swipe, the coloured line is only on the open tab (also in the Profile), and the focus ring appears only with the keyboard.
  - Grids in side tabs (Workflow > Components) have their buttons inside the header and rows as wide as the grid.
  - Navigation menu editor:
    - Assigned and Unassigned are stacked and open and close by tapping the heading.
    - Back above 900 px without reloading, the editor has no added controls.
  - The Invite to a role step bar fits inside the screen.
  - Statistics chart dates do not overlap.
  - There are no JavaScript errors from the plugin's files.
- **Drawer:**
  - A generic synthetic "other plugin", injected by the test and not tied to any real one, puts a class on `<html>` and a stylesheet that gives `#app-nav` a low z-index and a column width and makes its direct container absolute and narrow.
  - Reference: the desktop menu is captured with Mobile Dashboard's files blocked, without and with the synthetic plugin.
  - With and without the synthetic plugin, with ☰ closed there is one menu button, one backdrop and no part of the menu on screen; with ☰ open, several items receive taps (`elementFromPoint`) and the drawer is full width.
  - The window goes phone → desktop → phone without reloading, once with the menu left open. On the desktop the menu (computed layout, boxes, attributes, classes and inline styles of the menu, its container, `<html>` and `<body>`) must be exactly as without Mobile Dashboard, with no `md-*` classes; back on the phone the drawer works again and closes with no inline styles left.
- **Desktop:**
  - 17 pages and windows are captured at 1300 px with and without the plugin. Each pair must match to the pixel.
  - Before each capture, the check waits for the page to finish loading from the network.
  - A pair that differs is captured again once, because a list sometimes arrives from the API after the capture. If it matches on the second try, the check says so ("on the second try").
  - A difference caused by the plugin remains on the second try.

## Still checked by hand

- A test on a real phone. The suite simulates a 390×844 iPhone in Chrome.
- Installing the package on a live site.

## Settings

These can be changed with environment variables:

- `MD_LOCALE` (required): folder of the Docker copy, the one containing `docker-compose.yml`.
- `MD_BASE=http://localhost:8080`: address of the local copy. Only `localhost`, `127.0.0.1` or `[::1]` are accepted.
- `MD_JOURNAL=jse`: journal used by the tests (its path in the URL).
- `MD_WORKFLOW=69/3` and `MD_WORKFLOW2=12/4`: one submission in review and one in production (`id/stage`).
- `MD_ADMIN` and `MD_ADMIN_PASSWORD`: site administrator. If they are missing, the suite uses the first administrator in the database and the password written in `import-locale.ps1` in the Docker copy. The password is never printed.
- `MD_DISABLE`: other plugins that change the same pages, to disable during the tests. Use the names in `plugin_settings`, separated by spaces. Usually none.
- `MD_CHROME`: path to the browser, if it is not in the usual folder.

## Results

`tests/results/` (ignored by git) keeps:
- the phone images;
- the desktop image pairs that do not match;
- `browser.log`.

The data is placeholder data, but look at an image before publishing it.
