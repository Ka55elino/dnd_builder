/**
 * Print the current screen (and so "Save as PDF" from the system print dialog).
 *
 * Wails opens the native print dialog: on macOS it has a "PDF → Save as PDF"
 * button, on Windows pick "Microsoft Print to PDF". The page title becomes the
 * suggested file name. What gets printed and how is set by the @media print
 * rules in style.css (the app's chrome is hidden, the page is unrolled so all of
 * it is printed, not only what's scrolled into view).
 */
import { Window } from '@wailsio/runtime';

export async function printPage(title = '') {
    const prev = document.title;
    if (title) document.title = title;
    try {
        await Window.Print();
    } catch {
        window.print(); // plain browser / a platform without native printing
    } finally {
        // the dialog reads the title when it opens; put it back a bit later
        setTimeout(() => (document.title = prev), 1500);
    }
}
