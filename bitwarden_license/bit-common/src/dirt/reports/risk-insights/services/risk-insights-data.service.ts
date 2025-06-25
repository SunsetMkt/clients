import { BehaviorSubject, firstValueFrom } from "rxjs";
import { map, switchMap } from "rxjs/operators";

import { OrganizationId } from "@bitwarden/common/types/guid";
import { CipherService } from "@bitwarden/common/vault/abstractions/cipher.service";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import {
  AppAtRiskMembersDialogParams,
  ApplicationHealthReportDetail,
  ApplicationHealthReportSummary,
  AtRiskApplicationDetail,
  AtRiskMemberDetail,
  DrawerType,
} from "../models/password-health";

import { RiskInsightsApiService } from "./risk-insights-api.service";
import { RiskInsightsEncryptionService } from "./risk-insights-encryption.service";
import { RiskInsightsReportService } from "./risk-insights-report.service";
export class RiskInsightsDataService {
  private applicationsSubject = new BehaviorSubject<ApplicationHealthReportDetail[] | null>(null);
  private appsSummarySubject = new BehaviorSubject<ApplicationHealthReportSummary | null>(null);
  private isReportFromArchiveSubject = new BehaviorSubject<boolean>(true); // True by default

  applications$ = this.applicationsSubject.asObservable();
  appsSummary$ = this.appsSummarySubject.asObservable();
  isReportFromArchive$ = this.isReportFromArchiveSubject.asObservable();

  private isLoadingSubject = new BehaviorSubject<boolean>(false);
  isLoading$ = this.isLoadingSubject.asObservable();

  private isRefreshingSubject = new BehaviorSubject<boolean>(false);
  isRefreshing$ = this.isRefreshingSubject.asObservable();

  private errorSubject = new BehaviorSubject<string | null>(null);
  error$ = this.errorSubject.asObservable();

  private dataLastUpdatedSubject = new BehaviorSubject<Date>(new Date());
  dataLastUpdated$ = this.dataLastUpdatedSubject.asObservable();

  private cipherViewsForOrganizationSubject = new BehaviorSubject<CipherView[]>([]);
  cipherViewsForOrganization$ = this.cipherViewsForOrganizationSubject.asObservable();

  openDrawer = false;
  drawerInvokerId: string = "";
  activeDrawerType: DrawerType = DrawerType.None;
  atRiskMemberDetails: AtRiskMemberDetail[] = [];
  appAtRiskMembers: AppAtRiskMembersDialogParams | null = null;
  atRiskAppDetails: AtRiskApplicationDetail[] | null = null;

  constructor(
    private reportService: RiskInsightsReportService,
    private riskInsightsApiService: RiskInsightsApiService,
    private cipherService: CipherService,
    private riskInsightsEncryptionService: RiskInsightsEncryptionService,
  ) {}

  /**
   * Fetches the applications report and updates the applicationsSubject.
   * @param organizationId The ID of the organization.
   */
  fetchApplicationsReport(organizationId: string, isRefresh?: boolean): void {
    this.reportService.generateApplicationsReport$(organizationId).subscribe({
      next: (reports: ApplicationHealthReportDetail[]) => {
        this.applicationsSubject.next(reports);
        this.errorSubject.next(null);
        this.appsSummarySubject.next(this.reportService.generateApplicationsSummary(reports));
        this.dataLastUpdatedSubject.next(new Date());
      },
      error: () => {
        this.applicationsSubject.next([]);
      },
    });
  }

  fetchApplicationsReportFromCache(organizationId: string, isRefresh: boolean = false) {
    return this.riskInsightsApiService
      .getRiskInsightsReport(organizationId as OrganizationId)
      .pipe(
        map((reportFromArchive) => {
          if (isRefresh) {
            // we force a refresh if isRefresh is true
            // ignore all data from the server
            return null;
          }
          return reportFromArchive;
        }),
        switchMap(async (reportFromArchive) => {
          if (!reportFromArchive || !reportFromArchive?.date) {
            const report = await firstValueFrom(
              this.reportService.generateApplicationsReport$(organizationId),
            );
            const summary = this.reportService.generateApplicationsSummary(report);

            return {
              report,
              summary,
              fromArchive: false,
              lastUpdated: new Date(),
            };
          } else {
            const [report, summary] =
              await this.riskInsightsEncryptionService.decryptRiskInsightsReport(
                organizationId as OrganizationId,
                reportFromArchive,
              );

            return {
              report,
              summary,
              fromArchive: true,
              lastUpdated: new Date(reportFromArchive.date),
            };
          }
        }),
      )
      .subscribe({
        next: ({ report, summary, fromArchive, lastUpdated }) => {
          this.applicationsSubject.next(report);
          this.errorSubject.next(null);
          this.appsSummarySubject.next(summary);
          this.isReportFromArchiveSubject.next(fromArchive);
          this.dataLastUpdatedSubject.next(lastUpdated);
        },
        error: (error: unknown) => {
          this.errorSubject.next((error as Error).message);
          this.applicationsSubject.next([]);
        },
      });
  }

  async fetchCipherViewsForOrganization(
    organizationId: OrganizationId,
    isRefresh: boolean = false,
  ): Promise<void> {
    if (isRefresh) {
      this.cipherViewsForOrganizationSubject.next([]);
    }

    if (this.cipherViewsForOrganizationSubject.value.length > 0) {
      return;
    }

    const cipherViews = await this.cipherService.getAllFromApiForOrganization(organizationId);
    this.cipherViewsForOrganizationSubject.next(cipherViews);
  }

  isLoadingData(started: boolean): void {
    this.isLoadingSubject.next(started);
    this.isRefreshingSubject.next(started);
  }

  setReportFromArchiveStatus(isFromArchive: boolean): void {
    this.isReportFromArchiveSubject.next(isFromArchive);
  }

  refreshApplicationsReport(organizationId: string): void {
    this.isLoadingData(true);
    this.fetchApplicationsReportFromCache(organizationId, true);
  }

  isActiveDrawerType = (drawerType: DrawerType): boolean => {
    return this.activeDrawerType === drawerType;
  };

  setDrawerForOrgAtRiskMembers = (
    atRiskMemberDetails: AtRiskMemberDetail[],
    invokerId: string = "",
  ): void => {
    this.resetDrawer(DrawerType.OrgAtRiskMembers);
    this.activeDrawerType = DrawerType.OrgAtRiskMembers;
    this.drawerInvokerId = invokerId;
    this.atRiskMemberDetails = atRiskMemberDetails;
    this.openDrawer = !this.openDrawer;
  };

  setDrawerForAppAtRiskMembers = (
    atRiskMembersDialogParams: AppAtRiskMembersDialogParams,
    invokerId: string = "",
  ): void => {
    this.resetDrawer(DrawerType.None);
    this.activeDrawerType = DrawerType.AppAtRiskMembers;
    this.drawerInvokerId = invokerId;
    this.appAtRiskMembers = atRiskMembersDialogParams;
    this.openDrawer = !this.openDrawer;
  };

  setDrawerForOrgAtRiskApps = (
    atRiskApps: AtRiskApplicationDetail[],
    invokerId: string = "",
  ): void => {
    this.resetDrawer(DrawerType.OrgAtRiskApps);
    this.activeDrawerType = DrawerType.OrgAtRiskApps;
    this.drawerInvokerId = invokerId;
    this.atRiskAppDetails = atRiskApps;
    this.openDrawer = !this.openDrawer;
  };

  closeDrawer = (): void => {
    this.resetDrawer(DrawerType.None);
  };

  private resetDrawer = (drawerType: DrawerType): void => {
    if (this.activeDrawerType !== drawerType) {
      this.openDrawer = false;
    }

    this.activeDrawerType = DrawerType.None;
    this.atRiskMemberDetails = [];
    this.appAtRiskMembers = null;
    this.atRiskAppDetails = null;
    this.drawerInvokerId = "";
  };
}
