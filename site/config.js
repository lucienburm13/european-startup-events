window.EUSE_CONFIG = {
  eventsApiUrl: '',
  submissionApiUrl: '',
  tallyFormUrl: '',
  mapStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  calendars: {
    Main: {
      id: 'c_18d218cb371b633929609184a8b57308cb51dd4b664f3bd5b5a282388328583d@group.calendar.google.com'
    },
    Additional: {
      id: 'c_3d54144f81b5b17d5552e6efa3ea606aca5b435081337122bcb1000dc57d9f04@group.calendar.google.com'
    },
    Policy: {
      id: 'c_fe229d185c2798b6db19a30d8e60366ea24bd4fda9dbe1b8b9c6182ba9f84885@group.calendar.google.com'
    }
  },
  stack: {
    version: '0.1',
    state: 'planned',
    layers: [
      { name: 'Domain & DNS', provider: 'To be selected', country: '—', flag: '◻︎', status: 'pending' },
      { name: 'Hosting & compute', provider: 'Koyeb (planned)', country: 'France', flag: '🇫🇷', status: 'european' },
      { name: 'Data & storage', provider: 'Google Sheets', country: 'United States', flag: '🇺🇸', status: 'non-european' },
      { name: 'Software & runtime', provider: 'HTML / CSS / JavaScript', country: 'Open source / standards', flag: '🌐', status: 'open' },
      { name: 'Functional services', provider: 'Tally + European map stack (planned)', country: 'Belgium / Europe', flag: '🇧🇪 🇪🇺', status: 'european' },
      { name: 'Analytics & observability', provider: 'Plausible (planned)', country: 'Estonia', flag: '🇪🇪', status: 'european' },
      { name: 'AI & automation', provider: 'OpenAI', country: 'United States', flag: '🇺🇸', status: 'non-european' }
    ]
  }
};