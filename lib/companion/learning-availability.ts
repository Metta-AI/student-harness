import {defaultLeagueId} from '../league-catalog';

/** Pure capability selection: callers supply the current deployment gate. */
export function learningAvailable(leagueId:string,genericEnabled:boolean){
 return leagueId===defaultLeagueId||genericEnabled;
}
