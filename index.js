const cheerio = require("cheerio");
const axios = require("axios");
const { error } = require("console");
const schedule = require('node-schedule');

function parsePromiseChainFromKokaBooth(promiseResultArray) {
  return promiseResultArray.map((promiseResult) => {
    if (promiseResult.status === 200) {
      let dataObject = {};
      const { data, config } = promiseResult;
      const $ = cheerio.load(data);

      // parse the data
      const month = $('.m-date__month').text().trim().split(" ")[0];
      let day = $('.m-date__day').text().trim();
      if (day.split(" ").length > 2) {
        day = day.split(' ')[0];
      } else {
        day = day.slice(0, 2);
      }
      const year = $('.m-date__year').text().trim().split(', ')[1];
      dataObject.date = `${month} ${day}, ${year}`;
      dataObject.ticketsUrl = $('a.tickets.onsalenow').attr('href');
      dataObject.name = $('h1.title').text().trim().split('\t')[0];
      dataObject.time = $('li.item.sidebar_doors_open').find('span').text().trim();
      dataObject.eventUrl = config.url;
      return dataObject;
    } else { return null; }
  });
}

function convertKokaBoothDataStructureTo919EventsDataStructure(kokaBoothData) {
  return kokaBoothData.map(event => {
    let datetime;
    if (event.time.includes('PM')) {
      const pmHour = Number.parseInt(event.time.split(':')[0]) + 12;
      datetime = `${pmHour}:${event.time.split(':')[1].split('PM')[0]}:00`
    } else {
      datetime = `${event.time.split('AM')[0]}`;
    }
    datetime = event.date + ' ' + datetime;
    if (event.ticket.length <= 2) {
      return {
        name: event.name,
        url: event.eventUrl,
        datetime,
        venue: 63,
        cost: `${event.ticket[0]} - ${event.ticket[1]}`,
      }
    } else {
      return {
        name: event.name,
        url: event.eventUrl,
        datetime,
        venue: 63,
      }
    }
  });
}

async function scrapeKokaBoothShows() {
  const axiosResponse = await axios.request({
    method: "GET",
    url: "https://www.boothamphitheatre.com/events",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    }
  })

  if (axiosResponse.status === 200) {
    const $ = cheerio.load(axiosResponse.data);
    let promiseArray = [];
    $(".eventList__wrapper.list").find('.eventItem').each(async (idx, element) => {
      promiseArray.push(
        axios.request({
          method: "GET",
          url: $(element).find('.more.buttons-hide').attr('href'),
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
          }
        })
      )
    });
    const data = await Promise.all(promiseArray).then(parsePromiseChainFromKokaBooth);
    const ticketPagePromiseArray = [];
    data.map((event) => {
      ticketPagePromiseArray.push(
        axios.request({
          method: "GET",
          url: event.ticketsUrl,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
          }
        })
      );
    })
    const ticketData = await Promise.all(ticketPagePromiseArray).then((arr) => {
      return arr.map((etixPage) => {
        if (etixPage.status === 200) {
          let dataObject = {};
          const { data } = etixPage;
          const $ = cheerio.load(data);
          let prices = [];
          if ($('span[itemprop="lowPrice"]').text()) {
            const lowPrice = $('span[itemprop="lowPrice"]').text().trim().split(' ')[0];
            const highPrice = $('span[itemprop="highPrice"]').text().trim().split(' ')[0];
            prices.push(Number.parseFloat(lowPrice.split('$')[1]));
            prices.push(Number.parseFloat(highPrice.split('$')[1]));
          }
          if ($('div.ticket-info>label>span').length > 0) {
            $('div.ticket-info>label>span').each((idx, element) => {
              if ($(element).text().includes('$')) {
                prices.push(Number.parseFloat($(element).text().split('$')[1].split('\n')[0].trim()));
              }
            });
          } else {
            $('script:not([src])').each((idx, element) => {
              if (element.children[0].data.includes('sectionPriceRange')) {
                let jsonData = JSON.parse(element.children[0].data.split(';')[0].split('= ')[1]);
                if (typeof jsonData === 'object') {
                  prices = Object.values(jsonData).map(price => {
                    const priceNum = price.split('$')[1];
                    return Number.parseFloat(priceNum);
                  });
                }
              }
            });
          }
          let distinctPriceValues = [...new Set(prices)];
          if (distinctPriceValues.length > 0) {
            let formatter = {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 2,
            };
            let dollarFormatter = new Intl.NumberFormat('en-US', formatter)
            const min = distinctPriceValues.reduce((prev, next) => Math.min(prev, next));
            const max = distinctPriceValues.reduce((prev, next) => Math.max(prev, next));
            distinctPriceValues = [dollarFormatter.format(min), dollarFormatter.format(max)];
          }
          dataObject.prices = distinctPriceValues;
          return dataObject;
        } else return null;
      })
    });
    return data.map((event, index) => ({ ...event, ticket: ticketData[index].prices }));
  } else {
    error('an error has occurred');
    return ['an error has occurred'];
  }
}

async function scrapeCatsCradleShows() {
  const axiosResponse = await axios.request({
    method: "GET",
    url: "https://catscradle.com/events/",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    }
  })

  let eventsObjects = [];
  if (axiosResponse.status === 200) {
    const $ = cheerio.load(axiosResponse.data);
    $(".generalView")
      .find('.eventWrapper')
      .each((index, el) => {
        let obj = {};
        obj.name = $(el).find('#eventTitle').text().trim();
        obj.subhead = $(el).find('#evSubHead').text().trim();
        obj.date = $(el).find('#eventDate').text().trim();
        obj.time = $(el).find('i.rhp-events-icon.clock').next().text().trim();
        obj.price = $(el).find('i.rhp-events-icon.ticket').next().text().trim();
        obj.venue = $(el).find('.venueLink').text();
        obj.venueLink = $(el).find('.venueLink').attr('href');
        obj.eventLink = $(el).find('a.btn.btn-primary.btn-md.d-block.w-100').attr('href');
        obj.ticketLink = $(el).find('a.btn.btn-md.d-block.w-100').attr('href');

        if (!obj.price) {
          obj.price = 'Sold Out'
        }
        eventsObjects.push(obj);
      });
  } else {
    error('an error has occurred');
  }
  return eventsObjects.map((event) => {
    let eventDate = event.date.split(', ')[1] + ', 2024 ';
    let startTime = event.time.split('Show:')[1].trim();
    if (startTime.toLocaleLowerCase().includes('pm')) {
      if (startTime.includes(':')) {
        let hour = startTime.split(':')[0];
        let minute = startTime.split(':')[1].split('pm')[0];
        hour = `${Number.parseInt(hour) + 12}`;
        startTime = hour + ":" + minute + ':00';
      } else {
        startTime = (Number.parseInt(startTime.split('pm')[0]) + 12) + ':00:00';
      }
    } else {
      startTime = (startTime.split('am')[0]) + ':00:00';
    }
    let venue = event.venue;
    return {
      name: event.subhead !== '' ? event.name + ` with ${event.subhead}` : event.name,
      url: event.ticketLink,
      datetime: eventDate + startTime,
      venue,
      cost: event.price,
      type: 'music'
    };
  });
}

async function scrapeOakCityMusicCollectiveEvents() {
  const axiosResponse = await axios.request({
    method: "GET",
    url: "https://www.oakcitymusic.com/events",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    }
  })

  let eventsObjects = [];
  if (axiosResponse.status === 200) {
    const $ = cheerio.load(axiosResponse.data);

    // TODO: do something with the html here...
  } else {
    error('an error has occurred');
  }
  return {};
}

function textTrim(el) {
  return el.text().trim();
}

async function scrapePNCArenaEvents() {
  const { data } = await fetchMarkupData('https://www.pncarena.com/events');
  const $ = cheerio.load(data);

  const events = [];
  $('.eventItem.entry').each((idx, el) => {
    const ticketUrl = $(el).find('a.tickets.onsalenow').attr('href');
    if (!ticketUrl) {
      return; // canceled event
    }
    const event = {};
    event.name = $(el).find('h3.title>a[title="More Info"]').text();
    event.url = $(el).find('h3.title>a[title="More Info"]').attr('href');
    event.ticketUrl = ticketUrl;
    const dateContainer = $(el).find('.date>span');
    if (dateContainer.length > 1) {
      // there is a date range for the event
      const startMonth = textTrim($(dateContainer).find('.m-date__month'));
      const days = textTrim($(dateContainer).find('.m-date__day')).split('  ');
      const year = textTrim($(dateContainer).find('.m-date__year')).split('/ ')[1];
      event.date = `${startMonth} ${days[0]}-${days[1]}, ${year}`;
    } else {
      // there is one date for the event
      const month = textTrim($(dateContainer).find('.m-date__month'));
      const day = textTrim($(dateContainer).find('.m-date__day'));
      const year = textTrim($(dateContainer).find('.m-date__year')).split('/ ')[1];
      event.date = `${month} ${day}, ${year}`;
    }
    events.push(event);
  });
  return events;
}

async function exponentialBackoffFetch(url) {
  try {
    const response = await fetch(url);
    if (response.status === 200) {
      return response.json();
    } else if (response.status === 429) {
      // Wait a certain amount of time before retrying the request.
      const waitTime = Math.pow(2, 3);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      // Retry the request.
      return await exponentialBackoffFetch(url);
    } else {
      throw new Error('Unexpected response status: ' + response.status);
    }
  } catch (error) {
    console.error(error);
  }
};

/**
 * a function that calls the ticket master discovery api to get events for Raleigh/Durham.
 * in order to use this yourself, you'll have to create an account here https://developer-acct.ticketmaster.com/user/login
 * generate an API key for the discovery api and place your API key in the TM_API_KEY constant.
 * to generate a list of events for other markets/areas, replace the MARKET_ID constant with a valid 
 * ticketmaster market id https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/#supported-markets
 * @returns events [object] an array of objects each representing an event
 */
async function fetchTMEventsData() {
  const TM_API_KEY = 'insert_api_key_here'; // change this to your personal TicketMaster Discovery API Key
  const MARKET_ID = 38; // Raleigh & Durham = 38, https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/#supported-markets
  const axiosResponse = await axios.request({
    method: "GET",
    url: `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_API_KEY}&marketId=${MARKET_ID}`,
    headers: {
      "Connection": "Keep-Alive"
    }
  })
  const { events } = axiosResponse.data._embedded;
  const formattedEvents = events.map(async event => {
    const venueEndpoint = event._links.venues[0].href.split('?locale=en-us')[0];
    const data = await exponentialBackoffFetch(`https://app.ticketmaster.com${venueEndpoint}?apikey=${TM_API_KEY}`);
    const venue = await Promise.resolve(data);
    return {
      name: event.name,
      dateTime: event.dates.start.dateTime,
      url: event.url,
      priceRange: event.priceRanges[0],
      saleStatus: event.dates.status.code,
      images: event.images,
      venueName: venue.name,
    };
  });
  return Promise.all(formattedEvents);
}

async function scrapeTicketmasterEventPage(link) {
  const { data } = await fetchMarkupData(link);
  const $ = cheerio.load(data);
  const eventData = {};
  const menuItems = $('div[role="menu"]>div[role="menuitem"]');
  console.log(menuItems.length);
}

async function fetchMarkupData(url) {
  const axiosResponse = await axios.request({
    method: "GET",
    url: url,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    }
  })

  if (axiosResponse.status === 200) {
    return axiosResponse;
  } else {
    error('an error has occurred');
  }
  return { error: 'an error has occurred...' };
}

function writeToFile(filename, events) {
  let fs = require('fs');
  let file = fs.createWriteStream(filename);
  file.on('error', (err) => error(err));
  file.write('[');
  events.forEach((item) => {
    if (events.indexOf(item) !== events.length - 1) {
      file.write(JSON.stringify(item) + ',');
    } else {
      file.write(JSON.stringify(item));
    }
  })
  file.write(']')
  file.close();
}

function scheduleJobs(callbackFn) {
  const rule = new schedule.RecurrenceRule();
  rule.dayOfWeek = 7;
  rule.hour = 3;
  const job = schedule.scheduleJob(rule, callbackFn);
}

async function main() {
  if (process.argv.length > 2) {
    const option = process.argv[2];
    if (option === 'cc') {
      const catsCradleEvents = await scrapeCatsCradleShows();
      writeToFile('cats_cradle_events.json', catsCradleEvents);
      console.log(`${catsCradleEvents.length} cat's cradle events retrieved...`);
    } else if (option === 'kb') {
      const kokaBoothEvents = await scrapeKokaBoothShows();
      writeToFile('koka_booth_events.json', kokaBoothEvents);
      console.log(`${kokaBoothEvents.length} koka booth events retrieved...`);
    } else if (option === 'tm') {
      const ticketMasterEvents = await fetchTMEventsData();
      writeToFile('ticketmaster_events.json', ticketMasterEvents);
      console.log(`${ticketMasterEvents.length} ticket master events retrieved...`);
    }
  } else {
    const catsCradleEvents = await scrapeCatsCradleShows();
    const kokaBoothEvents = await scrapeKokaBoothShows();
    const ticketMasterEvents = await fetchTMEventsData();
    writeToFile('cats_cradle_events.json', catsCradleEvents);
    writeToFile('koka_booth_events.json', kokaBoothEvents);
    writeToFile('ticketmaster_events.json', ticketMasterEvents);
    console.log(`wrote ${catsCradleEvents.length + kokaBoothEvents.length + ticketMasterEvents.length} events to multiple files...`);
  }
}

main();