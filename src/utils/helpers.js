export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function getNYDateString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}
