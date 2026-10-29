// Independent bounded forecasting experiment over the retained 17/5 acquisition and economy object.
import { lateranoFocused } from './lateranoFocused.js';
import { developmentLayoutValue, prepareDevelopmentInput, developmentContext, observeDevelopment,
  selectDevelopmentForecast, commitDevelopment } from '../botLateranoDevelopment.js';
export const lateranoForecast = Object.freeze({ ...lateranoFocused, forecast: true, developmentForecast: true,
  layoutValue(gd, units, plan, bonds, model) {
    return lateranoFocused.layoutValue(gd, units, plan, bonds, model)
      + developmentLayoutValue(gd, units, plan, bonds, model, lateranoFocused);
  },
  prepareForecastInput: prepareDevelopmentInput,
  forecastContext: developmentContext,
  observeForecast: observeDevelopment,
  selectForecast: selectDevelopmentForecast,
  commitForecast: commitDevelopment });
