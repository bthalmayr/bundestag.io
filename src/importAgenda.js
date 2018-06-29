import Scraper from "@democracy-deutschland/bt-agenda";
import moment from "moment";
import axios from "axios";

import CONSTANTS from "./config/constants";

import Procedure from "./models/Procedure";
import Agenda from "./models/Agenda";

let procedureIds = [];

const checkDocuments = async data => {
  await Promise.all(
    data.map(async ({ rows, year, week, meeting, date, ...rest }) => {
      await Agenda.findOneAndUpdate(
        { year, week, meeting },
        { rows, year, week, meeting, date: new Date(date), ...rest },
        {
          upsert: true
        }
      );
      await Promise.all(
        rows.map(async ({ dateTime, topicDocuments: documents, status }) => {
          const igonreDocs = status
            .filter(stat => stat.indexOf("Überweisung") === 0)
            .map(stat => {
              return stat.match(/(\d{1,3}\/\d{1,10})/gs); // eslint-disable-line
            });

          if (igonreDocs.length > 0) {
            return;
          }

          const procedures = await Procedure.find({
            "importantDocuments.number": { $in: documents }
          });
          if (procedures.length > 0) {
            const promisesUpdate = procedures.map(
              async ({ procedureId, currentStatus }) => {
                if (
                  currentStatus === "Beschlussempfehlung liegt vor" ||
                  currentStatus === "Überwiesen"
                ) {
                  await Procedure.findOneAndUpdate(
                    {
                      procedureId
                    },
                    {
                      $set: { "customData.expectedVotingDate": dateTime }
                    }
                  ).then(data => {
                    if (data) {
                      procedureIds.push(procedureId);
                    }
                  });
                  return true;
                }
              }
            );
            await Promise.all(promisesUpdate);
          }
        })
      );
    })
  );
};

const syncWithDemocracy = async () => {
  if (procedureIds.length > 0) {
    await axios
      .post(`${CONSTANTS.DEMOCRACY.WEBHOOKS.UPDATE_PROCEDURES}`, {
        data: { procedureIds },
        timeout: 1000 * 60 * 5
      })
      .then(async response => {
        console.log(response.data);
      })
      .catch(error => {
        console.log(`democracy server error: ${error}`);
      });
    procedureIds = [];
  }
};

const scraper = new Scraper();
(async () => {
  scraper.addListener("data", checkDocuments);
  scraper.addListener("finish", syncWithDemocracy);

  const agenda = await Agenda.find({})
    .sort({
      year: -1,
      week: -1,
      meeting: -1
    })
    .limit(5);
  let startWeek = 3;
  let startYear = 2017;
  const lastPastAgenda = agenda.find(({ week, year }) => {
    return week <= moment().week() || year < moment().year();
  });
  if (lastPastAgenda) {
    startWeek = lastPastAgenda.week;
    startYear = lastPastAgenda.year;
  }
  scraper
    .scrape({
      startWeek,
      startYear,
      continue: true
    })
    .catch(error => {
      console.error(error);
    });
})();
